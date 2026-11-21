/*
 Copyright (C) 2025 - 2026 3NSoft Inc.

 This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

 This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

 You should have received a copy of the GNU General Public License along with this program. If not, see <http://www.gnu.org/licenses/>.
*/
import { defaultSignupURL, stdSignupLink, customSignupLink } from '@/constants';

export interface SignupParamsViaURL {
  signupUrl: string;
  isStandardService?: true;
  token: string | undefined;
}

export function signupParamsFromCurrentURL(): SignupParamsViaURL | undefined {
  const h = location.hash;
  if (h) {
    try {
      return JSON.parse(atob(h.substring(1)));
    } catch (err) {
      console.error(err);
    }
  }
}

export function parse3NWebURL(urlStr: string): SignupParamsViaURL | undefined {
  const indOfLastSlash = urlStr.lastIndexOf('/');
  if (indOfLastSlash < 0) {
    return;
  }
  const token = urlStr.substring(indOfLastSlash + 1);
  let signupUrl = new URL(`https://${urlStr.substring(customSignupLink.length, indOfLastSlash + 1)}`).href
  if ((new URL(signupUrl)).hostname.endsWith('.onion')) {
    signupUrl = `http${signupUrl.substring(5)}`;
  }
  if (urlStr.startsWith(customSignupLink)) {
    return {
      signupUrl,
      token,
    };
  } else if (urlStr.startsWith(stdSignupLink)) {
    return {
      signupUrl: defaultSignupURL,
      isStandardService: true,
      token,
    };
  }
}

export function signupParamsToLink(params: SignupParamsViaURL): string {
  const { isStandardService, signupUrl, token } = params;
  if (isStandardService) {
    return token ? `${stdSignupLink}${token}` : '';
  } else {
    return `${customSignupLink}${signupUrl.substring(8)}${token ? token : ''}`;
  }
}
