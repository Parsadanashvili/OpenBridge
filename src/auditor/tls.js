// Transport probe for https targets (GE-SEC-TLS12, GE-SEC-MTLS, GE-SEC-OCSP). Read-only handshakes, no payload sent beyond a HEAD-style request line.
const tls = require('tls');
const net = require('net');

function connect(host, port, opts, send) {
  return new Promise((resolve) => {
    const out = { connected: false };
    let sock;
    try {
      sock = tls.connect({ host, port, servername: net.isIP(host) ? undefined : host, rejectUnauthorized: false, timeout: 5000, ...opts }, () => {
        out.connected = true; out.protocol = sock.getProtocol(); out.authorized = sock.authorized; out.cert = sock.getPeerCertificate();
        if (send) sock.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        else sock.end();
      });
    } catch (e) { out.error = `unsupported: ${e.message}`; resolve(out); return; }
    sock.on('OCSPResponse', (r) => { out.ocsp = !!r; });
    let data = '';
    sock.on('data', (d) => { data += d; });
    sock.on('error', (e) => { out.error = e.code || e.message; resolve(out); });
    sock.on('timeout', () => { out.error = 'timeout'; sock.destroy(); });
    sock.on('close', () => { out.http = /^HTTP\/1\.\d \d{3}/.test(data); resolve(out); });
  });
}

// returns { tls12, oldTlsRefused, oldTlsInconclusive, mtlsEnforced, stapled, protocol, certExpires }
async function probe(bank) {
  const u = new URL(bank.baseUrl); if (u.protocol !== 'https:') return null;
  const host = u.hostname, port = Number(u.port || 443);
  const modern = await connect(host, port, { minVersion: 'TLSv1.2', requestOCSP: true });
  const res = { reachable: modern.connected, protocol: modern.protocol, stapled: !!modern.ocsp, certExpires: modern.cert && modern.cert.valid_to, subject: modern.cert && modern.cert.subject && modern.cert.subject.CN };
  // old protocol attempt: refused = good; if our own client cannot attempt it, the result is inconclusive (never a pass)
  const old = await connect(host, port, { minVersion: 'TLSv1', maxVersion: 'TLSv1.1', ciphers: 'DEFAULT@SECLEVEL=0' });
  res.oldTlsRefused = !old.connected && !!old.error && !/no protocols available|unsupported/i.test(String(old.error));
  res.oldTlsInconclusive = !old.connected && /no protocols available|unsupported/i.test(String(old.error || ''));
  res.oldTlsAccepted = old.connected;
  // client certificate: connect without one and try to talk
  const noCert = await connect(host, port, { minVersion: 'TLSv1.2' }, true);
  res.mtlsEnforced = !noCert.connected || !noCert.http;
  return res;
}
module.exports = { probe };
