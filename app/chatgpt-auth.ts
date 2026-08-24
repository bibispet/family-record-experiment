import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { headerIdentityProvider } from "./lib/identity";

export type ChatGPTUser = {
  userId: string;
  displayName: string;
  email: string;
  fullName: string | null;
};

const SIGN_OUT_PATH = "/signout-with-chatgpt";
const CALLBACK_PATH = "/callback";
const SIGN_IN_PATH = "/signin-with-chatgpt";

// Legacy header adapter — reimplemented as the "header" IdentityProvider.
// Behaviour is unchanged when the header provider is selected. This module
// remains for backwards compatibility; new code should use app/lib/identity.
export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const viewer = headerIdentityProvider.resolveViewer(requestHeaders as unknown as Headers);
  if (!viewer) return null;
  return {
    userId: viewer.subjectId,
    email: viewer.email,
    displayName: viewer.displayName ?? viewer.email,
    fullName: viewer.displayName,
  };
}

export async function requireChatGPTUser(returnTo: string): Promise<ChatGPTUser> {
  const user = await getChatGPTUser();
  if (user) return user;
  redirect(chatGPTSignInPath(returnTo));
}

export function chatGPTSignInPath(returnTo: string): string {
  return headerIdentityProvider.signInPath(returnTo);
}

export function chatGPTSignOutPath(returnTo = "/"): string {
  const safeReturnTo = safeRelativeReturnPath(returnTo);
  return `${SIGN_OUT_PATH}?return_to=${encodeURIComponent(safeReturnTo)}`;
}

function safeRelativeReturnPath(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  let url: URL;
  try {
    url = new URL(value, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local") return "/";
  if (isReservedAuthPath(url.pathname)) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function isReservedAuthPath(pathname: string): boolean {
  return pathname === SIGN_IN_PATH || pathname === SIGN_OUT_PATH || pathname === CALLBACK_PATH;
}
