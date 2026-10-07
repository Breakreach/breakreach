import { Operations, type UploadMediaFileResponse } from "./generated";
import type { RequestOptions } from "./core";

export * from "./generated";
export { BreakreachError, BreakreachConnectionError, VERSION, DEFAULT_BASE_URL } from "./core";
export type { ClientOptions, RequestOptions } from "./core";

/**
 * Breakreach API client.
 *
 * ```ts
 * import { Breakreach } from "breakreach";
 *
 * const br = new Breakreach(); // reads BREAKREACH_API_KEY
 * const { accounts } = await br.listAccounts();
 * const { post } = await br.createPost({
 *   content: "Meet Morning Light, our new blend.",
 *   accountIds: accounts.map((a) => a.id),
 *   useNextSlot: true,
 * });
 * ```
 *
 * Every method maps to one endpoint of https://api.breakreach.com/v1 and is
 * named after its operationId in the OpenAPI spec. POST calls carry an
 * Idempotency-Key, so the built-in retries never create a post twice.
 */
export class Breakreach extends Operations {
  /**
   * Upload a local file to Breakreach storage and get the URL to put in
   * createPost's media. `POST /v1/media/upload`, up to 100 MB: JPG, PNG, WebP,
   * GIF, MP4, MOV, WebM or PDF, recognised by the file name's extension.
   *
   * @param file A path (Node), or a Blob / File with `options.filename`
   */
  async uploadMediaFile(file: string | Blob, options: RequestOptions & { filename?: string } = {}): Promise<UploadMediaFileResponse> {
    let blob: Blob;
    let filename = options.filename;
    if (typeof file === "string") {
      const [{ readFile }, { basename }] = await Promise.all([import("node:fs/promises"), import("node:path")]);
      blob = new Blob([new Uint8Array(await readFile(file))]);
      filename ??= basename(file);
    } else {
      blob = file;
      filename ??= (file as File).name;
    }
    if (!filename) throw new Error("uploadMediaFile needs a filename with an extension, e.g. { filename: \"photo.jpg\" }");
    const form = new FormData();
    form.append("file", blob, filename);
    return this.request("POST", "/v1/media/upload", { body: form, options });
  }
}

export default Breakreach;
