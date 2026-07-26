/**
 * Host backdrop detection under happy-dom. `getComputedStyle` here resolves
 * inline and stylesheet `background-color` declarations, which is exactly the
 * surface the sampler reads.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { computedColorToHex, resolveBackdropColor } from '../src/core/backdrop';

function mount(html: string): Element {
  document.body.innerHTML = html;
  const host = document.querySelector('#host');
  if (!host) throw new Error('host missing');
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
  document.body.removeAttribute('style');
  document.documentElement.removeAttribute('style');
});

describe('computedColorToHex', () => {
  it('converts rgb and opaque rgba to hex', () => {
    expect(computedColorToHex('rgb(255, 255, 255)')).toBe('#ffffff');
    expect(computedColorToHex('rgb(5, 7, 13)')).toBe('#05070d');
    expect(computedColorToHex('rgba(18, 52, 86, 1)')).toBe('#123456');
    expect(computedColorToHex('rgba(18 52 86 / 0.9)')).toBe('#123456');
  });

  it('treats fully and mostly transparent colours as not painting', () => {
    expect(computedColorToHex('rgba(0, 0, 0, 0)')).toBeNull();
    expect(computedColorToHex('rgba(255, 255, 255, 0.2)')).toBeNull();
    expect(computedColorToHex('transparent')).toBeNull();
  });

  it('returns null for syntaxes it cannot read', () => {
    expect(computedColorToHex('color(display-p3 1 1 1)')).toBeNull();
    expect(computedColorToHex('linear-gradient(#fff, #000)')).toBeNull();
    expect(computedColorToHex('')).toBeNull();
    expect(computedColorToHex(null)).toBeNull();
  });

  it('clamps out-of-range channels rather than emitting invalid hex', () => {
    expect(computedColorToHex('rgb(300, -20, 12)')).toBe('#ff000c');
  });
});

describe('resolveBackdropColor', () => {
  it('takes the host element background when it paints one', () => {
    const host = mount('<div id="host" style="background-color: rgb(18, 52, 86)"></div>');
    expect(resolveBackdropColor(host, '#05070d')).toBe('#123456');
  });

  it('walks up to the first painting ancestor', () => {
    document.body.style.backgroundColor = 'rgb(5, 7, 13)';
    const host = mount('<section><div id="host"></div></section>');
    expect(resolveBackdropColor(host, '#ffffff')).toBe('#05070d');
  });

  it('resolves an unstyled page to the white browser canvas, not the fallback', () => {
    const host = mount('<div id="host"></div>');
    expect(resolveBackdropColor(host, '#05070d')).toBe('#ffffff');
  });

  it('resolves an unstyled dark-scheme page to the dark browser canvas', () => {
    document.documentElement.style.colorScheme = 'dark';
    const host = mount('<div id="host"></div>');
    expect(resolveBackdropColor(host, '#05070d')).toBe('#121212');
  });

  it('crosses a shadow boundary to the host page background', () => {
    document.body.style.backgroundColor = 'rgb(27, 58, 107)';
    const wrapper = mount('<div id="host"></div>');
    const shadow = wrapper.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    shadow.append(inner);
    expect(resolveBackdropColor(inner, '#000000')).toBe('#1b3a6b');
  });

  it('falls back when there is no element to sample', () => {
    expect(resolveBackdropColor(null, '#05070d')).toBe('#05070d');
  });
});
