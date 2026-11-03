// Optional preload for Hallmark's render/capture scripts against protected demo routes.
// HALLMARK_ACCOUNT=teacher node --import ./scripts/hallmark-auth.mjs <hallmark-script> ...
import puppeteer from 'puppeteer-core';
const url = process.env.HALLMARK_APP_URL || 'http://localhost:3000';
const email =
  process.env.HALLMARK_ACCOUNT === 'teacher' ? 'teacher@detuquy.vn' : 'student@detuquy.vn';
const response = await fetch(`${url}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password: process.env.HALLMARK_PASSWORD || 'Demo@2026' }),
});
if (!response.ok) throw new Error('Could not authenticate the Hallmark preview account.');
const cookie = response.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error('Session cookie missing.');
const separator = cookie.indexOf('=');
const launch = puppeteer.launch.bind(puppeteer);
puppeteer.launch = async (...args) => {
  const browser = await launch(...args);
  await browser.setCookie({
    name: cookie.slice(0, separator),
    value: cookie.slice(separator + 1),
    domain: new URL(url).hostname,
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
  });
  return browser;
};
