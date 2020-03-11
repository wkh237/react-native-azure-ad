// @flow
import React, { Component } from 'react'
import {Dimensions, AsyncStorage, Platform } from 'react-native'
import WebView from 'react-native-webview'
import CONST from './const.js'
import ReactNativeAD from './ReactNativeAD.js'
import Timer from 'react-timer-mixin'
import log from './logger'
import { appConstants } from '../../../app/common/appConstants.js';

// acc
const loginUrl = 'https://visionplannerdevb2c.b2clogin.com/<tenant id>/oauth2/v2.0/authorize'
//PRDV2
//const loginUrl = 'https://visionplannerb2c.b2clogin.com/<tenant id>/oauth2/v2.0/authorize'
//const loginUrl = 'https://login.microsoftonline.com/<tenant id>/oauth2/v2.0/authorize'
//const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/token'
const tokenUrl = 'https://login.microsoftonline.com/<tenant id>/oauth2/token'

export default class ADLoginView extends React.Component {

  props: {
    onSuccess?: ?Function,
    onViewUpdate?: ?Function,
    toggleLoadingIcon?: ?Function,
    onRequestSent?: ?Function,
    onCancel?: ?Function,
    needLogout?: bool,
    style: any,
    onURLChange: Function,
    context: ReactNativeAD,
    hideAfterLogin?: bool,
  };

  state: {
    page: string,
    visible: bool
  };

  static defaultProps = {
    authority_host: loginUrl,
    tenant: 'common',
    onSuccess: () => { },
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
    this.calledOnce = false;
  }

  componentWillUpdate(nextProps: any, nextState: any): any {
    console.log(nextState.page)
    if (this.state.visible === nextState.visible && this.state.page === nextState.page)
      return false
    return true
  }

  componentDidUpdate(prevProps: any, prevState: any) {
    if (prevState.visible !== this.state.visible)
      this.props.onVisibilityChange && this.props.onVisibilityChange(this.state.visible)
    let onViewUpdate = this.props.onViewUpdate || function () { }
    onViewUpdate();
    log.debug('ADLoginView updated.')
    this.calledOnce = false;
  }

  componentWillReceiveProps(nextProps) {
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

  getStyle = () => {
    if(Platform.OS === 'ios'){
      return this.props.style, {
          flex: 1,
          alignSelf: 'stretch',
          width: Dimensions.get('window').width,
          height: Dimensions.get('window').height
        }
    }
    return this.props.style
  }
  render() {
    // Fix visibility problem on Android webview
    let js = `document.getElementsByTagName('body')[0].style.height = '${Dimensions.get('window').height}px';`

    return (
      this.state.visible ? (
      <WebView
        ref="ADLoginView"
        automaticallyAdjustContentInsets={false}
        style={[this.getStyle()]}
        useWebKit={false}
        allowFileAccess={true}
        originWhitelist={['*']}
        source={{ uri: this.state.page }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        userAgent={"Mozilla/5.0 (Linux; Android 6.0.1; SM-G920V Build/MMB29K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.98 Mobile Safari/537.36"}
        onLoadEnd={() => {
          let toggleLoadingIcon = this.props.toggleLoadingIcon || function () { }
          toggleLoadingIcon(false)
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
        startInLoadingState={false}
        injectedJavaScript={js}
        scalesPageToFit={true} />) : null
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
    let policy = context.getConfig().policy

    if (context !== null) {
      let result = `${authUrl}?response_type=code` +
        `&client_id=${context.getConfig().client_id}` +
        // `&scope=${context.getConfig().client_id}%20offline_access` +
        //`&scope=https://devb2corg.onmicrosoft.com/WebAPI/offline_access` +
        `&scope=${context.getConfig().scope}` +
        (policy ? `&p=${context.getConfig().policy}` : '') +
        (redirect ? `&redirect_uri=${context.getConfig().redirect_uri}&nonce=rnad-${Date.now()}` : '') +
        (prompt ? `&prompt=${context.getConfig().prompt}` : '')

      log.debug('Authorize url ' + result)
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
    let isVPLogin = false;
    if(e.url.includes("login.microsoftonline.com")){
      isVPLogin = true;
      if(Platform.OS === appConstants.common.platformIos){
      this.props.setNavBarTitle();
    }
    }
    log.verbose('ADLoginView navigate to', e.url)
    let onRequestSent = this.props.onRequestSent || function () { }

    let onCancel = this.props.onCancel || function () { }
    //Sign In to LinkedIn
    log.verbose('ADLoginView navigate to', e.url)

    try {
      if ((e.url.indexOf('server_error') != -1 || e.url.indexOf('error') != -1) && !this.calledOnce) {
        onCancel();
        this.calledOnce = true;
      } else if ((e.url.indexOf('server_error') != -1 || e.url.indexOf('error') != -1) && this.calledOnce) {
        onRequestSent(false, isVPLogin);
        onCancel();
        this.calledOnce = true;
      } else {
        //if ((pageTitle.indexOf('sign in') >= 0 || pageTitle.title == 'sign up or sign in' || e.url.indexOf('prompt=login') != -1) && !this.calledOnce) {
        if (!this.calledOnce) {
          if (e.url.indexOf('prompt=login') != -1) {
            onRequestSent(false, isVPLogin);
          } else {
            onRequestSent(true, isVPLogin);
          }
        }
        this.calledOnce = true;
      }
    } catch (e) {
      if ((e.url.indexOf('server_error') != -1 || e.url.indexOf('error') != -1) && !this.calledOnce) {
        onCancel();
        this.calledOnce = true;
      }
    }

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

      log.verbose('ADLoginView._handleADToken code=', code[0])
      code = String(code[0]).replace(/(\?|\&)?code\=/, '')

      let subCode = ''

      if (code !== null) {
        subCode = code.substring(0, 2)
      }

      //Verify if the starting of the authorization code grand starts with ey
      if (subCode == 'ey') {
        code = code.replace('#', '')
        code = code.replace('_=_', '')
        this._lock = true
        this.setState({ visible: !this.props.hideAfterLogin })
        this.props.onVisibilityChange && this.props.onVisibilityChange(false)
        this._getResourceAccessToken(code).catch((err) => {
          log.error('ADLoginView._getResourceAccessToken', err)
        })
      }
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

    let { client_id = null, redirect_uri = null, client_secret = null, resources = null, scope = null } = adConfig
    // Transform resource string to array
    if (typeof resources === 'string')
      resources = [resources]
    else if (Array.isArray(resources))
      resources = resources.length === 0 ? null : resources

    log.verbose('ADLoginView get access token for resources=', resources)

    let promises: Array<Promise> = []
    let config = {
      client_id, redirect_uri
      , client_secret
      // set resource to common by default
      //: 'https://VPB2COrg.onmicrosoft.com/VPService/read offline_access'
      , scope
      , code
      //,policy
    }

    if (resources === null || resources === void 0) {
      promises.push(context.grantAccessToken(CONST.GRANT_TYPE.AUTHORIZATION_CODE, config))
    }
    // Get access_token for each resource
    else {
      promises = resources.map((rcs, i) => {
        let cfg = Object.assign({}, config, { resource: rcs })
        return context.grantAccessToken(CONST.GRANT_TYPE.AUTHORIZATION_CODE, cfg)
      })
    }
    return Promise.all(promises).then((resps: Array<GrantTokenResp>) => {

      log.verbose('ADLoginView response access info ', resps)
      let toggleLoadingIcon = this.props.toggleLoadingIcon || function () { }
      toggleLoadingIcon(true)
      if (!this.props.context)
        throw new Error('value of property `context` is invalid=', this.props.context)

      let context = this.props.context
      let onSuccess = this.props.onSuccess || function () { }

      // trigger loggined finished event
      if (context !== null && typeof this.props.onSuccess === 'function')
        onSuccess(context.getCredentials())
      this._lock = false

    }).catch((err) => {
      //throw new Error('Failed to acquire token for resources', err.stack)
      log.error(err.stack);
    })
  }

}
