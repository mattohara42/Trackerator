import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendNoteToClaude } from "../lib/github.ts";

const realFetch = globalThis.fetch;

/** Answers the CLAUDE.md read with `file`, and records any write. */
function stubGitHub(file: unknown) {
  const writes: RequestInit[] = [];
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (init?.method === "PUT") {
      writes.push(init);
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify(file), { status: 200 });
  }) as typeof fetch;
  return writes;
}

const send = () =>
  sendNoteToClaude({ token: "t", fullName: "me/demo", branch: "main", note: "hello" });

describe("sendNoteToClaude", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("appends to an existing CLAUDE.md", async () => {
    const writes = stubGitHub({
      content: Buffer.from("# Project\n\nKeep me.\n").toString("base64"),
      encoding: "base64",
      sha: "abc",
    });
    await send();

    assert.equal(writes.length, 1);
    const body = JSON.parse(writes[0].body as string);
    const written = Buffer.from(body.content, "base64").toString("utf-8");
    assert.match(written, /Keep me\./);
    assert.match(written, /: hello$/m);
    assert.equal(body.sha, "abc");
  });

  // Over 1 MB, the Contents API returns the file's sha with an empty `content`
  // and `encoding: "none"`. Read as an empty file, that replaced the whole
  // CLAUDE.md with a single note.
  it("refuses to write when the file is too large to read", async () => {
    const writes = stubGitHub({ content: "", encoding: "none", sha: "abc", size: 2_000_000 });
    await assert.rejects(send, /CLAUDE\.md/);
    assert.equal(writes.length, 0, "nothing was committed");
  });

  it("refuses to write when CLAUDE.md is a directory", async () => {
    const writes = stubGitHub([{ name: "notes.md", type: "file" }]);
    await assert.rejects(send, /CLAUDE\.md/);
    assert.equal(writes.length, 0, "nothing was committed");
  });
});
