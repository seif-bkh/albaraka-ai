import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App (back-office)', () => {
  it('créé le composant racine', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
