declare namespace web3n.start {

  type User = {
    login: string;
    password: string;
    passwordConfirm?: string;
    name?: string;
    domain?: string;
    signupToken?: string;
    customServiceUrl?: string;
    availableDomains?: string[];
  }

}