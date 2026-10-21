# Clair — données génériques TEST v1, révision active2 EUR uniquement

**Tout est fictif.** Le fichier `tests/fixtures/clair-test-generic-v1.json` sert aux futures recettes R1 d'import/qualité/différences de sources. Il ne contient aucune pièce pilote, donnée PayFit/DSN réelle, convention collective, règle légale, taux réel ou validation RH. Il ne crée aucun espace client et n'est pas embarqué ou importé en production par ce lot.

**Changement de périmètre humain du18octobre2026 à09:15UTC**, et non correction d'un bug : multisociété **EUR uniquement pour l'instant**. Le jeu multicurrency précédent, ses tests et sa preuve `57a2e0441c026260c5731b984f85e5cd44e662b3` sont conservés sur `codex/clair-saas-r1-demo-multicurrency` et dans Git. La branche active `codex/clair-saas-r1-demo-eur` porte `datasetRevision:2` avec formatVersion1 et identités inchangés. Toutes sociétés/contrats/périodes sont EUR, toutes listes exchangeRates sont vides. Les valeurs numériques de TEST conservées sont de nouveaux exemples EUR, **pas une conversion** de l'ancien jeu USD. Le modèle générique R0 gelé `3991a4d`, ses corps/hashes et sa capacité FX dormante restent intacts ; la neutralité produit conserve null, aucune devise par défaut.

Le générateur indépendant `scripts/generate-clair-test-generic.mjs` expose `generateClairTestGeneric()` et `serializeClairTestGeneric(value)`. Son appel pur ne lit ni n'écrit de fichier. Le CLI accepte uniquement `--write` (destination TEST fixe ci-dessus) ou `--check` (comparaison de cette seule fixture). Aucun horodatage courant, aléa, secret, environnement privé, réseau ou lecture d'un pilote n'intervient. Les deux instants de photographie sont des valeurs de TEST fixées.

```sh
node scripts/generate-clair-test-generic.mjs --write
node scripts/generate-clair-test-generic.mjs --check
node --test tests/clair-test-generic.test.mjs
```

## Profils indépendants

|Profil|Personnes / contrats|Sociétés / devises|Périodes par photographie|Photographies|
|---|---:|---|---:|---:|
|TEST-PROFILE-A|8 / 8|1 société TEST, EUR|161|2|
|TEST-PROFILE-B|18 / 18|1 société TEST, EUR|401|2|
|TEST-PROFILE-C|45 / 45|2 sociétés TEST, toutes deux EUR|1049|2|

Chaque profil couvre les **24 mois explicites d'octobre2024 à septembre2026**. Les 71 personnes ont des IDs anonymes TEST ; elles n'existent pas hors du jeu. Deux photographies complètes sont conservées par profil : révision1 au1octobre2026 et révision2 au2octobre2026, timestamps fixes de TEST. Les données de chaque profil et de chaque photographie sont des objets indépendants.

Les configurations sont des **exemples choisis**, distincts des défauts neutres du produit R0. Références de temps plein2400/2100/2250minutes hebdomadaires, taux de charges4000/2500/3000bps, maintien10000/0/5000bps et trois modes d'arrondi sont des paramètres de TEST explicites. Ils ne constituent aucun préréglage conventionnel. Le profil B choisit explicitement le prorata `none` avec bornes null ; A/C choisissent `calendar-days` avec bornes true/false. Les trois configurations déclarent exclusivement la devise EUR et `exchangeRates:[]`. **Aucun cours ou calcul FX n'est actif** ; aucune conversion, réciproque ou reconduction n'est inférée.

## DTO versionné et unités

Racine : `{kind:'clair-test-generic',formatVersion:1,datasetRevision:2,id,classification,scope,assurance,profiles}`. `classification=TEST_ONLY_FICTITIOUS`, les cinq garanties `realData/businessValidated/payrollCalculated/currencyConverted/collectiveAgreementPreset` valent false. `scope.currency='EUR'` ; `scope.months` contient les24 mois, sans période2027 ajoutée.

Chaque profil contient id/label/fictional/personCount, `configurationExample` conforme au DTO R0, `photographs:[photo1,photo2]` et `corrections`. Chaque photographie contient id/revision/capturedAt/sourceKind/fictional/businessValidated puis :

- `people` : IDs et externalId exacts, libellés TEST, provenance ; aucun rapprochement par nom.
- `contracts` : IDs/parents personne et société, type de TEST, début, fin connue ou fin ouverte déclarée, devise/unité, brut mensuel temps plein explicite, quotitébps, minutes hebdomadaires contractuelles et de référence, provenance. `endDate:null` n'est ici permis qu'avec le statut explicite `open-ended-declared`.
- `periods` : identité période/personne/contrat/société/mois, devise et unité, `grossMinor`, `employerChargesMinor`, `paidMinutes`, `workedMinutes`, états TEST et provenance. Les montants sont des **unités mineures EUR** (minorUnit2 explicitement choisi dans ce jeu), sans conversion. Les durées sont des minutes, pas un ETP. Les valeurs sont des enregistrements fictifs explicites ; elles ne sont pas produites par le calcul des règles de configuration.
- `absences` : IDs exacts, parents, type TEST-SICKNESS / TEST-MATERNITY / TEST-PAID-LEAVE, dates et minutes enregistrées ou null. Trois absences par photographie/profil, sans maintien ou durée légale déduits. La maternité a volontairement une durée en minutes inconnue malgré ses dates.
- `quality` : neuf constats par photographie, ciblés par collection/recordId/champ et provenance. Un constat reste `TEST-REVIEW-REQUIRED` tant que sa source fictive est incomplète ; les deux champs formellement complétés passent seulement `TEST-FORMALLY-CORRECTED`, jamais validés métier.

Les lignes comportent une provenance `synthetic-test`, un sourceId TEST et `businessValidated:false`. Les héritages de la première photographie gardent leur provenance exacte ; seuls les objets formellement modifiés pointent vers la seconde. `contentHash` est SHA256 de `JSON.stringify(photoSansContentHash)` dans l'ordre déterministe du générateur. C'est une empreinte de cette fixture, pas une signature d'un fournisseur ou une preuve d'authentification.

## Cas attendus et corrections formelles

Une entrée au1avril2025, une sortie au31décembre2025 et une entrée au15février2026 sont présentes dans chaque profil. Aucune période n'est générée avant le mois de début connu ou après le mois de fin connue. Le premier mois partiel de février2026 conserve **quatre champs numériques inconnus** : aucun prorata ou salaire complet inventé. Les volumes sont `personnes×24−31`, soit161/401/1049 par photographie. Les autres lignes permettent temps pleins et quotités80%/50% explicites.

Un mois de juin2025 contient un brut/minutes payées/minutes travaillées explicitement égaux à0. Juillet2025 d'un autre contrat contient des montants et minutes travaillées null, sans les confondre avec ces zéros. Les valeurs mensuelles de charges restent des enregistrements TEST indépendants de la règle budgétaire d'exemple : aucune cohérence paie/taux ou annualisation n'est affirmée.

Trois corrections exactement par profil, toujours à identité constante : libellé d'une personne ; brut inconnu de juillet2025 vers224012 unités mineures explicitement fournies ; minutes payées inconnues de novembre2025 vers0 connu. Chaque correction enregistre collection/recordId/champ, avant/après, motif, sourceId et révisions1→2. Elle ne réécrit pas la photographie1. Les charges et minutes travaillées encore inconnues de juillet restent null dans la photographie2 ; aucune complétion induite depuis le nouveau brut. Un diff R1 doit distinguer ces corrections de la validation métier et conserver toutes les autres valeurs.

## Recette et limites

Sept groupes ciblés passent : déterminisme octet pour octet, volumes/parents/source TEST, entrées/sorties, inconnus/zéros, reproduction exacte des trois corrections, EUR-only sur tous les profils/deux sociétés C sans cours/conversion, et absence de lecture externe/pilote. Les attentes multicurrency historiques ne sont pas réécrites dans Git ; cette révision applique une nouvelle décision D-SCOPE. Contrôle supplémentaire en mémoire contre le modèle R0 gelé `3991a4d` (seul import commun remappé vers son URL locale, aucun fichier modifié) : trois configurations EUR valides et inspectées complètes ; cela ne prouve aucune calculabilité financière.

La fixture JSON indentée active pèse2716996octets, SHA256 `28329ace8910f8790b9cb326b672289acf1950b311eaedb656b5f1a412a39ce1`. Les photographies compactes pèsent respectivement83095/83122,199127/199154 et512419/512446octets ; les configurations939/899/1016octets. Le document complet n'est pas une configuration32Kio, un draft A1 ou un corps HTTP d'import existant. Les futurs adaptateurs doivent sélectionner explicitement profil/photographie/collection, proposer leurs gabarits et contrôler leurs propres enveloppes avant import ; ne pas téléverser cet agrégat dans une ancienne route pour prétendre R1 livré.

Les champs plats et identités se prêtent à des gabarits CSV/Excel versionnés ; ce lot ne fournit pas encore ces importeurs, aucun mapping PayFit/DSN exécuté, aucun KPI source activé et aucun résultat de paie. La preuve est un jeu de recette local figé. R1 ne sera livré qu'après un vrai parcours d'import/qualité/historique testé et publié ; aucune ancienne livraison, donnée pilote, audience ou empreinte A1 n'est modifiée.
