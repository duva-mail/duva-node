/** Small formatting helpers matched to the API's own parsing rules (`docs/api.md`). */

/** `Name <address>` (with `Name` quoted if it contains a `"` or `,`), or just `address` without a
 * name. */
export function formatAddress(email: string, name?: string): string {
  if (!name) return email;
  const quoted = /[",]/.test(name) ? `"${name.replace(/"/g, '\\"')}"` : name;
  return `${quoted} <${email}>`;
}

export interface UnsubscribeOptions {
  /** An `https://` link the recipient can open to unsubscribe. */
  httpsUrl?: string;
  /** A `mailto:` address to unsubscribe by email. */
  mailto?: string;
  /** Adds `List-Unsubscribe-Post` (one-click unsubscribe, RFC 8058): requires `httpsUrl`. `true`
   * by default when `httpsUrl` is given. */
  oneClick?: boolean;
}

/** Builds `List-Unsubscribe` (and `List-Unsubscribe-Post` for one-click) exactly as the API
 * validates them: at most 3 links, `https://` or `mailto:` only. Throws `TypeError` when neither
 * `httpsUrl` nor `mailto` is given. */
export function unsubscribeHeaders(options: UnsubscribeOptions): Record<string, string> {
  const { httpsUrl, mailto, oneClick = httpsUrl !== undefined } = options;
  if (!httpsUrl && !mailto) {
    throw new TypeError("Duva: unsubscribeHeaders needs httpsUrl and/or mailto");
  }
  if (httpsUrl && !httpsUrl.startsWith("https://")) {
    throw new TypeError("Duva: unsubscribeHeaders.httpsUrl must be an https:// link");
  }
  const links = [httpsUrl && `<${httpsUrl}>`, mailto && `<mailto:${mailto}>`].filter(
    (link): link is string => Boolean(link),
  );
  const headers: Record<string, string> = { "List-Unsubscribe": links.join(", ") };
  if (oneClick) {
    if (!httpsUrl) {
      throw new TypeError("Duva: one-click unsubscribe (List-Unsubscribe-Post) needs httpsUrl");
    }
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return headers;
}
