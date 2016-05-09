//@flow

declare type ADConfig = {
  client_secret : string | null,
  client_id : string | null,
  redirect_uri : string | null,
  tenant : string | null,
  resources : Array<string> | null,
};

declare type ADCredentials = {
  [key:string] : ReactNativeADCredential | null
}

declare type GrantTokenResp = {
  resource : string,
  response : Object
};

declare type ReactNativeADConfig = {
  client_id : string,
  redirect_uri? : string,
  authority_host : string,
  tenant : string,
  client_secret : string,
  resources : any,
  onSuccess : Function,
};

declare type ReactNativeADCredential = {
  access_token : string,
  expires_in : number,
  expires_on : number,
  id_token : string,
  not_before : number,
  pwd_exp : string,
  pwd_url : string,
  refresh_token : string,
  resource : string,
  scope : string,
  token_type : 'Bearer'
};
