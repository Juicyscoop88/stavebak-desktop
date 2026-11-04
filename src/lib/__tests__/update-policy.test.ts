import { describe, expect, it } from 'vitest';
import { canRestartNow, compareVersions, isUpdateMandatory, type TabWork } from '../update-policy';

const idle: TabWork = { busy: false, inputDraft: '', pendingAttachments: 0, pendingUserMessages: 0 };

describe('compareVersions', () => {
  it('porovná číselně, ne jako text', () => {
    expect(compareVersions('0.16.0', '0.16.2')).toBe(-1);
    expect(compareVersions('0.16.10', '0.16.2')).toBe(1);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });
  it('neplatná verze je nejnižší', () => {
    expect(compareVersions('dev', '0.1.0')).toBe(-1);
  });
});

describe('isUpdateMandatory', () => {
  it('bez min_version je aktualizace povinná', () => {
    expect(isUpdateMandatory('0.16.0', { version: '0.16.2' })).toBe(true);
    expect(isUpdateMandatory('0.16.0', undefined)).toBe(true);
  });
  it('pod min_version povinná, od ní dobrovolná', () => {
    expect(isUpdateMandatory('0.16.0', { min_version: '0.16.2' })).toBe(true);
    expect(isUpdateMandatory('0.16.2', { min_version: '0.16.2' })).toBe(false);
    expect(isUpdateMandatory('0.17.0', { min_version: '0.16.2' })).toBe(false);
  });
  it('neplatné min_version bere jako chybějící', () => {
    expect(isUpdateMandatory('0.17.0', { min_version: 'x' })).toBe(true);
  });
});

describe('canRestartNow', () => {
  it('bez konverzací a v klidu smí', () => {
    expect(canRestartNow([])).toBe(true);
    expect(canRestartNow([idle, idle])).toBe(true);
  });
  it('nesmí, když Claude pracuje', () => {
    expect(canRestartNow([idle, { ...idle, busy: true }])).toBe(false);
  });
  it('nesmí přijít o rozepsaný text, přílohu ani frontu', () => {
    expect(canRestartNow([{ ...idle, inputDraft: 'ahoj' }])).toBe(false);
    expect(canRestartNow([{ ...idle, inputDraft: '   ' }])).toBe(true);
    expect(canRestartNow([{ ...idle, pendingAttachments: 1 }])).toBe(false);
    expect(canRestartNow([{ ...idle, pendingUserMessages: 1 }])).toBe(false);
  });
});
