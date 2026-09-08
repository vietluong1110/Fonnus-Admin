/**
 * The `<audio src="/calls/<id>/recording">` endpoint (ADR 0004). It answers a
 * `302` to a freshly presigned GET on the bucket and never carries a byte of
 * audio itself: the bytes go bucket → browser, which is why the URL is renewed
 * on every media request (first byte, every seek) instead of being baked into
 * the page at render time.
 *
 * It is also the second enforcement of the consent gate for audio: a withheld
 * call has no presigned URL anywhere, whatever a page chose to render.
 */
import { NextResponse } from 'next/server';
import { presignCallWav, recordingAccess } from '@/artifacts';
import { callState, isUuid } from '@/calls';
import { getConfig } from '@/config';
import { withheldStateReason } from '@/playback';
import { getCall } from '@/queries/calls';

// A presigned URL is minted per request and expires; nothing here may be cached
// or prerendered.
export const dynamic = 'force-dynamic';

/** Every answer of this route is one line of text nobody caches. */
function plain(status: number, body: string): Response {
  return new Response(`${body}\n`, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await ctx.params;
  // The same check `src/app/calls/[id]/page.tsx` runs, from the same helper, so
  // a malformed id never reaches SQL.
  if (!isUuid(id)) return plain(404, 'no such call');

  let call;
  try {
    call = await getCall(id);
  } catch (err) {
    // The database is unreachable or refusing us — distinct from any state of
    // the recording itself, so it is not one of the map's answers.
    const reason = err instanceof Error ? err.message : String(err);
    process.stderr.write(`recording route: reading call ${id} failed: ${reason}\n`);
    return plain(500, 'recording unavailable: the call could not be read from the database');
  }
  if (call === null) return plain(404, 'no such call');

  const access = recordingAccess(call, getConfig());
  switch (access) {
    case 'not_configured':
      return plain(503, 'recording access is not configured: the S3_* group is unset');
    case 'not_archived':
      return plain(
        404,
        `recording not in the bucket yet: artifact_state ${call.artifact_state ?? 'null'}`,
      );
    case 'gone':
      return plain(404, 'recording gone: no artifact_key_prefix left on the call row');
    case 'withheld':
      // Trap 2: a call with no consent row has not refused — it is still running,
      // or its finish transaction never completed. The page says the same thing.
      return plain(
        403,
        call.outcome === null
          ? `recording withheld: the call is ${withheldStateReason(callState(call.ended_at, call.outcome))}, no consent outcome on record yet`
          : `recording withheld: consent outcome ${call.outcome}`,
      );
    case 'playable': {
      // `recordingAccess` never says playable without a prefix; the check is
      // for the type only.
      if (call.artifact_key_prefix === null) return plain(404, 'recording gone');
      const response = NextResponse.redirect(await presignCallWav(call.artifact_key_prefix), 302);
      response.headers.set('cache-control', 'no-store');
      return response;
    }
  }
}
