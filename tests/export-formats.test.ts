import { test, expect } from 'bun:test';
import { fileExtension, formatLabel } from '../src/export/formats';

test('EPUB is always epub regardless of toolchain', () => {
  expect(fileExtension('epub', { calibreAvailable: false, kfxReady: false })).toBe('epub');
  expect(fileExtension('epub', { calibreAvailable: true, kfxReady: true })).toBe('epub');
});

test('the Kindle ladder prefers KFX, then AZW3, then MOBI', () => {
  expect(fileExtension('kindle', { calibreAvailable: true, kfxReady: true })).toBe('kfx');
  expect(fileExtension('kindle', { calibreAvailable: true, kfxReady: false })).toBe('azw3');
  expect(fileExtension('kindle', { calibreAvailable: false, kfxReady: false })).toBe('mobi');
});

test('the Kindle label names the format it will actually produce', () => {
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: false })).toContain('AZW3');
  expect(formatLabel('kindle', { calibreAvailable: false, kfxReady: false })).toContain('MOBI');
});

test('only the KFX rung claims best quality', () => {
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: true })).toContain('best quality');
  expect(formatLabel('kindle', { calibreAvailable: true, kfxReady: false })).not.toContain('best quality');
});
