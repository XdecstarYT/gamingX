// gx-broadcast-push — send a Web Push notification to every subscribed device.
// Admin-only: the caller must have a row in public.gx_admins. VAPID keys come
// from public.app_secrets. Deploy with verify_jwt = true.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization') || '';

    // Who is calling?
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await asUser.auth.getUser();
    const uid = u?.user?.id;
    if (!uid) return json({ ok: false, error: 'not_signed_in' }, 401);

    const admin = createClient(url, service);
    const { data: adminRow } = await admin.from('gx_admins').select('user_id').eq('user_id', uid).maybeSingle();
    if (!adminRow) return json({ ok: false, error: 'not_admin' }, 403);

    const { title, body, url: clickUrl } = await req.json().catch(() => ({}));
    if (!title) return json({ ok: false, error: 'missing_title' }, 400);

    // VAPID from app_secrets
    const { data: secrets } = await admin.from('app_secrets').select('key,value').in('key', ['vapid_public', 'vapid_private']);
    const map: Record<string, string> = {};
    (secrets || []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
    if (!map.vapid_public || !map.vapid_private) return json({ ok: false, error: 'vapid_missing' }, 500);
    webpush.setVapidDetails('mailto:decmar098@gmail.com', map.vapid_public, map.vapid_private);

    const { data: subs } = await admin.from('push_subscriptions').select('*');
    const payload = JSON.stringify({ title, body: body || '', icon: '/assets/icon-192.png', url: clickUrl || '/index.html' });

    let sent = 0, gone = 0;
    for (const s of subs || []) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) { await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint); gone++; }
      }
    }
    return json({ ok: true, sent, gone, total: (subs || []).length });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
});
