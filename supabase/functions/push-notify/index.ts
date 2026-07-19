// GamingX push-notify — sends Web Push to a user's devices.
// Auth: custom x-push-secret header (checked against app_secrets), so JWT
// verification is disabled. VAPID keys are read from the locked app_secrets
// table via the service role — no secrets live in this file or the repo.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(url, serviceKey);

    const { data: secretsRows } = await admin.from('app_secrets').select('key,value').in('key', ['push_secret', 'vapid_public', 'vapid_private']);
    const secrets = Object.fromEntries((secretsRows || []).map((s: any) => [s.key, s.value]));
    const provided = req.headers.get('x-push-secret') || '';
    if (!secrets.push_secret || provided !== secrets.push_secret) {
      return new Response('unauthorized', { status: 401 });
    }

    const { user_id, title, body, tag, url: clickUrl } = await req.json();
    if (!user_id) return new Response('missing user_id', { status: 400 });

    const { data: subs } = await admin.from('push_subscriptions').select('*').eq('user_id', user_id);
    if (!subs || !subs.length) return new Response(JSON.stringify({ sent: 0 }), { headers: { 'Content-Type': 'application/json' } });

    webpush.setVapidDetails('mailto:push@gamingx.app', secrets.vapid_public, secrets.vapid_private);
    const payload = JSON.stringify({ title: title || 'GamingX', body: body || '', tag: tag || '', url: clickUrl || '' });

    let sent = 0;
    await Promise.all((subs as any[]).map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        sent++;
      } catch (e: any) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) await admin.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
      }
    }));

    return new Response(JSON.stringify({ sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e: any) {
    return new Response('error: ' + (e && e.message ? e.message : String(e)), { status: 500 });
  }
});
