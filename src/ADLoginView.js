// @flow
import React, { Component } from 'react'
import { Dimensions, AsyncStorage, Platform } from 'react-native'
import { WebView } from 'react-native-webview'
import CONST from './const.js'
import ReactNativeAD from './ReactNativeAD.js'
import Timer from 'react-timer-mixin'
import log from './logger'

const loginUrl = 'https://login.microsoftonline.com/<tenant id>/oauth2/authorize'
const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/token'

export default class ADLoginView extends React.Component {

  props: {
    onSuccess?: ?Function,
    renderError?: ?Function,
    needLogout?: bool,
    style: any,
    onURLChange: Function,
    context: ReactNativeAD,
    hideAfterLogin?: bool,
    userAgent?: string
  };

  state: {
    page: string,
    visible: bool
  };

  static defaultProps = {
    authority_host: loginUrl,
    tenant: 'common',
    onSuccess: () => { },
    renderError: () => { },
    onPageRequest: null
  };

  _needRedirect: bool;
  _onTokenGranted: () => {};
  _lock: bool;
  _accessToken: Object;

  constructor(props: any) {
    super(props)
    if (!this.props.context instanceof ReactNativeAD)
      throw new Error('property `context` of ADLoginView should be an instance of ReactNativeAD, but got', this.props.context)
    let context = this.props.context
    let tenant = context.getConfig().tenant
    this._needRedirect = this.props.needLogout || false
    this.state = {
      page: this._getLoginUrl(tenant || 'common'),
      visible: true,
    }
    this._lock = false
  }

  UNSAFE_componentWillUpdate(nextProps: any, nextState: any): any {
    if (this.state.visible === nextState.visible && this.state.page === nextState.page)
      return false
    return true
  }

  componentDidUpdate(prevProps: any, prevState: any) {
    if (prevState.visible !== this.state.visible)
      this.props.onVisibilityChange && this.props.onVisibilityChange(this.state.visible)
    log.debug('ADLoginView updated.')
  }

  UNSAFE_componentWillReceiveProps(nextProps) {
    if (!this.props.needLogout && nextProps.needLogout) {
      let context = this.props.context
      let tenant = context.getConfig().tenant
      this._needRedirect = nextProps.needLogout || false
      this.setState({
        page: this._getLoginUrl(tenant || 'common'),
        visible: true
      })
    }
  }

  render() {
    // Fix visibility problem on Android webview
    let js = `document.getElementsByTagName('body')[0].style.height = '${Dimensions.get('window').height}px';`
    let renderError = this.props.renderError || function () { }
    return (
      this.state.visible ? (<WebView
        ref="ADLoginView"
        automaticallyAdjustContentInsets={false}
        style={[this.props.style, {
          flex: 1,
          alignSelf: 'stretch',
          width: Dimensions.get('window').width,
          height: Dimensions.get('window').height
        }]}
        source={{ uri: this.state.page }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        onLoadEnd={() => {
          if (this._needRedirect) {
            this._needRedirect = false
            let tenant = this.props.context.getConfig().tenant || 'common'
            this.setState({ page: this._getLoginUrl(tenant) })
          }
        }}
        decelerationRate="normal"
        javaScriptEnabledAndroid={true}
        onNavigationStateChange={this._handleADToken.bind(this)}
        onShouldStartLoadWithRequest={(e) => {
          return true
        }}
        userAgent={this.props.userAgent}
        renderError={() => renderError(this.refs.ADLoginView.reload)}
        startInLoadingState={false}
        injectedJavaScript={js}
      />) : null
    )
  }

  /**
   * Get authority host URI,
   * @param {string} tenant Custom tenant ID, this filed is optional, default
   *                        values is `common`.
   * @return {string} The Authority host URI.
   */
  _getLoginUrl(tenant: string = 'common'): string {

    let authUrl = String(this.props.authority_host || loginUrl).replace('<tenant id>', tenant)
    let context = this.props.context || null
    let redirect = context.getConfig().redirect_uri
    let prompt = context.getConfig().prompt
    let login_hint = context.getConfig().login_hint

    if (context !== null) {
      let result = `${authUrl}?response_type=code` +
        `&client_id=${context.getConfig().client_id}` +
        (redirect ? `&redirect_url=${context.getConfig().redirect_uri}&nonce=rnad-${Date.now()}` : '') +
        (prompt ? `&prompt=${context.getConfig().prompt}` : '') +
        (login_hint ? `&login_hint=${context.getConfig().login_hint}` : '')

      if (this._needRedirect)
        result = `https://login.windows.net/${this.props.context.getConfig().client_id}/oauth2/logout`
      return result
    }
    else {
      throw new Error('AD context should not be null/undefined.')
    }
  }

  /**
   * An interceptor for handling webview url change, when it detects possible
   * authorization code in url, it will triggers authentication flow.
   * @param  {object} e Navigation state change event object.
   */
  _handleADToken(e: { url: string }): any {
    log.verbose('ADLoginView navigate to', e.url)
    if (this._lock)
      return true
    let code = /((\?|\&)code\=)[^\&]+/.exec(e.url)

    if (this._needRedirect) {
      // this._needRedirect = false
      return true
    }

    if (this.props.onURLChange)
      this.props.onURLChange(e)

    if (code !== null) {
      this._lock = true
      log.verbose('ADLoginView._handleADToken code=', code[0])
      code = String(code[0]).replace(/(\?|\&)?code\=/, '')
      this.setState({ visible: !this.props.hideAfterLogin })
      this.props.onVisibilityChange && this.props.onVisibilityChange(false)
      this._getResourceAccessToken(code).catch((err) => {
        log.error('ADLoginView._getResourceAccessToken', err)
      })
      return true
    }

    return true

  }

  /**
   * Check required properies and show error.
   * @param  {ReactNativeADConfig} config Configration object input.
   */
  _checkProperties(config: any) {

    ['client_id', 'redirect_uri', 'authority_host'].forEach((prop) => {
      if (!config.hasOwnProperty(prop))
        throw new Error(`ReactNativeAD config object must have \`${prop}\` property`)
    })

  }

  /**
   * Get access token for each resoureces
   * @param {string} code The authorization code from `onNavigationStateChange`
   *                      callback.
   * @return {Promise<void>}
   */
  _getResourceAccessToken(code: string): Promise {

    let context = this.props.context

    if (!context)
      throw new Error('property `context` of ADLoginView should not be null/undefined')

    let adConfig: ADConfig = this.props.context.getConfig()

    let { client_id = null, redirect_uri = null, client_secret = null, resources = null } = adConfig
    // Transform resource string to array
    if (typeof resources === 'string')
      resources = [resources]
    else if (!Array.isArray(resources) || resources.length === 0)
      resources = ["common"];

    log.verbose('ADLoginView get access token for resources=', resources)


    /* NOTE: as of 11/15/2018, MS has changed the token behavior in that we cannot re-use the same auth-code more than once to get all the resource tokens. 
    *  Instead we must use the refresh token result from the first token request to get other resource tokens. 
    *  https://docs.microsoft.com/en-us/azure/active-directory/fundamentals/whats-new#change-notice-authorization-codes-will-no-longer-be-available-for-reuse
    *  https://social.msdn.microsoft.com/Forums/en-US/4192e141-309a-4dd6-a5c9-f1a8ce32f4ca/aadsts54005-oauth2-authorization-code-was-already-redeemed?forum=WindowsAzureAD
    */

    let promises: Array<Promise> = []
    let [resourceFirst, ...resourcesOther] = resources;
    let config = { client_id, redirect_uri, code, client_secret, resource: resourceFirst }

    return context.grantAccessToken(CONST.GRANT_TYPE.AUTHORIZATION_CODE, config).then(cred => {
      //remove AUTHORIZATION_CODE specific properties because we are now going to use the REFRESH_TOKEN for all the remaining resources
      delete config.code;
      delete config.redirect_uri;
      config.refresh_token = cred.response.refresh_token;

      //get array of promises for all the resource token acquisitions to perform in parallel
      let promises = resourcesOther.map(resource => {
        let cfg = Object.assign({}, config, { resource });
        return context.grantAccessToken(CONST.GRANT_TYPE.REFRESH_TOKEN, cfg);
      });

      //wait on the resource promises, then finalize
      return Promise.all(promises).then((resps: Array<GrantTokenResp>) => {

        log.verbose('ADLoginView response access info ', resps)

        if (!this.props.context)
          throw new Error('value of property `context` is invalid=', this.props.context)

        let context = this.props.context
        let onSuccess = this.props.onSuccess || function () { }

        // trigger loggined finished event
        if (context !== null && typeof this.props.onSuccess === 'function')
          onSuccess(context.getCredentials())
        this._lock = false

      }).catch((err) => {
        throw new Error('Failed to acquire token for resources', err.stack)
      });
    });
  }

}
