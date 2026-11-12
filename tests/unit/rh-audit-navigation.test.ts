import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FamilyTabs } from '@/components/FamilyTabs';
import { GlossaryLink } from '@/components/GlossaryLink';
import { MS_TAB_GROUPS } from '@/app/e/[slug]/studio-rh/masse-salariale/tabs';

describe('Navigation RH simplifiée sans perte de destinations', () => {
  it('les trois groupes conservent chaque destination et signalent le sous-écran courant', () => {
    const keys=MS_TAB_GROUPS.flatMap(group=>[...group.keys]);
    const tabs=keys.map(key=>({key,label:`Vue ${key}`,href:`/fictif/${key}`}));
    const html=renderToStaticMarkup(h(FamilyTabs,{tabs,current:'suivi',label:'Vues',testid:'ms-tabs',groups:MS_TAB_GROUPS}));
    for(const {href} of tabs)expect(html.split(`href="${href}"`).length-1).toBe(1);
    expect(html).toContain('Décomposition');expect(html).toContain('Écarts');
    expect(html).toContain('family-tab-group is-current');expect(html).toContain('<small>Vue suivi</small>');
    expect((html.match(/data-tab=/g)??[]).length).toBe(9);
  });
  it('les entrées prévues restent accessibles à la fin de la barre', () => {
    const html=renderToStaticMarkup(h(FamilyTabs,{tabs:[{key:'prevu',label:'Futur',href:'/prevu',soon:true},{key:'livre',label:'Livré',href:'/livre'}],current:'livre',label:'Vues',testid:'tabs'}));
    expect(html.indexOf('href="/livre"')).toBeLessThan(html.indexOf('href="/prevu"'));
    expect(html).toContain('class="tab-planned"');expect(html).toContain('Prévu');
  });
  it('l’aide garde une destination fonctionnelle sans quitter la page au clic normal', () => {
    const html=renderToStaticMarkup(h(GlossaryLink,{slug:'fictif',term:'masse'}));
    expect(html).toContain('href="/e/fictif/glossaire#def-masse"');
    expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('aria-expanded="false"');
  });
});
