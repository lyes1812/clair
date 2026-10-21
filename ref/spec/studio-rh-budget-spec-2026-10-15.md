# Clair. Studio RH — outils de modélisation budgétaire

**Cahier des charges complémentaire · 15 octobre 2026 · ajout DSN et API RH PayFit · périmètre France / EUR en premier**

Ce document intègre la demande complémentaire de Lyes de prévoir l’import des DSN et la lecture des contrats, collaborateurs et temps via PayFit. Il traduit aussi les 21 captures du webinaire « Réduire le cycle budgétaire avec Scénario RH », fournies par Lyes, en exigences pour Clair. Il complète le cahier des charges social enrichi, sections 1 à 10, sans remplacer les règles et ajustements déjà retenus. Les fonctions recensées sont **à construire ou à compléter** ; leur inscription à la feuille de route ne les active pas.

Le [catalogue structuré des 32 exigences](studio-rh-budget-requirements-2026-10-15.json) porte les identifiants, priorités proposées, dépendances, preuves dans le code actuel et critères de validation. Il est consultable et exportable dans la feuille de route privée de Clair.

## État du premier lot — 15 octobre 2026

Le développement du premier lot est désormais engagé à la demande de Lyes. **Sources RH** fournit l’import DSN natif P25V01/P26V01 avec aperçu et conservation séparée, ainsi que les lecteurs PayFit des collaborateurs, contrats et temps. Les quatre capacités RH-BUD-029 à 032 passent de prévues à partielles : elles ne constituent pas encore un référentiel rapproché ni un nouveau moteur budgétaire.

Les lecteurs PayFit ont été testés sur réponses synthétiques puis vérifiés sur le compte MiiMOSA après accord explicite de Lyes : clé RH dédiée, quatre droits de lecture et stockage comme secret du Site privé. Les 21 DSN historiques et trois photographies API sont conservées et vérifiées après rechargement. Les nouvelles sources restent séparées du réalisé actif et des ajustements existants. Les limites, formats et étapes d’activation figurent dans [la note du premier lot](studio-rh-lot1-sources-2026-10-15.md).

## État du second lot — 15 octobre 2026

Le rapprochement DSN–PayFit prépare des propositions de personnes et contrats, les écarts par champ et une référence de travail versionnée. Chaque correspondance exige une confirmation avec note ; les sources, ajustements et KPI actuels restent séparés. Les photographies API actuelles ne sont pas présentées comme des états historiques. La revue métier, les contrôles de montants et la validation d’une référence active restent à terminer. Voir [la note du second lot](studio-rh-lot2-reference-2026-10-15.md).


## État du troisième lot — 15 octobre 2026

La revue documentaire et l’activation versionnée de septembre permettent d’alimenter les personnes/contrats déclarés et la rémunération brute non plafonnée DSN dans Studio RH. La différence nom de naissance/nom d’usage est sourcée ; les temps restent à qualifier. Montants comptables, extourne et ajustements de gestion restent séparés. Voir [la validation documentaire et ses limites](studio-rh-lot3-validation-2026-10-15.md).


## 1. Problème à résoudre

Studio RH sait analyser les données disponibles et simuler certains ajustements, enveloppes et départs. Il lui manque un modèle RH général reliant une référence figée, des hypothèses datées, des salariés ou postes, des rubriques et des résultats mensuels reproductibles. Une prévision de coût ne doit pas devenir un faux réalisé, un changement de poste ne doit pas écraser l'historique, et un écart doit pouvoir être expliqué jusqu'à sa source.

Le besoin est de préparer un budget ou un révisé RH, comparer ses variantes avec le réalisé et le budget antérieur, puis expliquer les variations d'effectifs, d'ETP et de coût.

## 2. Objectifs et limites

Objectifs :

- Prévoir l’import des fichiers DSN et les lectures API PayFit de collaborateurs, contrats et temps, avec rapprochement, couverture et provenance explicites.
- Construire un budget mensuel à partir d'une référence réelle documentée, puis gérer des variantes indépendantes et figées.
- Modéliser les entrées, départs, remplacements, mutations, quotités et événements de rémunération avec leurs dates d'effet.
- Appliquer des hypothèses globales, par société et ciblées, avec une règle de priorité visible.
- Analyser les mêmes résultats en synthèse, détail, grille, graphique et export ; expliquer les écarts avec un pont exact.
- Garder la charte Clair : fond blanc, typographie et tailles de la Vue d'ensemble, gris/noir, bleu mesuré, filtres cohérents et détails repliables.

Hors périmètre de cette livraison : nouveau moteur de paie, génération de bulletins, écritures dans PayFit, édition des données historiques, déclarations sociales, procédures de départ, paiement, validation juridique d'une BDESE, accès d'équipe ou IA active. Les fonctions périphériques seulement nommées dans un menu sont consignées comme pistes à préciser. Aucun calendrier de livraison n'est engagé.

## 3. Sources et niveau de preuve

Chaque capture possède un ID, son nom de fichier, son heure de capture, sa taille et son empreinte SHA-256 dans le [manifeste](scenario-rh-capture-manifest-2026-10-15.json). Les 21 images originales restent dans Downloads ; elles ne sont pas recopiées dans le projet ou publiées dans l'application.

Les relevés séparent ce qui est visible, les commandes affichées, les critères proposés pour Clair et les éléments non vérifiés :

- [Exploration des effectifs et menu général — 7 captures](scenario-rh-evidence-exploration-2026-10-15.json).
- [Postes, embauches et mouvements — 7 captures](scenario-rh-evidence-planning-2026-10-15.json).
- [Hypothèses, écarts et reporting social — 7 captures](scenario-rh-evidence-analytics-2026-10-15.json).

Une commande visible ne prouve pas son fonctionnement. Un menu ne prouve ni la profondeur d'une fonction ni ses formules. Les noms, montants, effectifs, taux et échanges du webinaire ne sont pas des données MiiMOSA et ne doivent pas alimenter les modèles. Les exigences locales complémentaires sont indiquées comme telles.

## 4. Parcours utilisateurs attendus

| Rôle / besoin | Parcours et résultat attendu |
|---|---|
| Finance : lancer un budget | Choisir une référence, une date de bascule et un horizon ; vérifier les données manquantes ; créer une version indépendante. |
| RH : préparer les mouvements | Ajouter un poste, une embauche ou un changement daté ; consulter le coût et l'ETP par mois avant validation dans le scénario. |
| Finance / RH : modifier les hypothèses | Saisir une règle avec son périmètre, son unité et sa date ; prévisualiser les cibles et l'impact ; enregistrer une nouvelle version traçable. |
| Manager, quand les droits seront développés | Préparer une enveloppe ou des postes sur son périmètre autorisé, sans accéder aux rémunérations hors périmètre. |
| Direction : comparer | Sélectionner jusqu'à trois versions et des périodes comparables ; lire les écarts absolus, relatifs et leur explication. |
| Contrôle : vérifier | Retrouver source, ajustement et hypothèse d'un résultat ; rapprocher total, détail et export. |

L'accès courant reste privé au propriétaire. Les rôles d'équipe sont des exigences futures et doivent être vérifiés avant toute ouverture de données individuelles.

## 5. Modèle de données et calcul

### Couches distinctes

1. **Sources réelles** : journal comptable PayFit et autres sources identifiées, avec période, provenance, empreinte et date de lecture. Une synchronisation comptable n'atteste ni paiement ni dépôt DSN.
2. **Lecture de gestion ajustée** : retraitements explicites, documentés et réversibles, reliés à la source sans la modifier.
3. **Référentiel RH** : identifiants stables de personne, contrat et poste ; affectations temporelles et quotités provenant d'une source vérifiée.
4. **Scénarios** : référence figée, règles, événements, enveloppes et hypothèses avec unités, dates et version.
5. **Résultats calculés** : détail mensuel par poste/personne et rubrique, agrégats, alertes, version du moteur et des paramètres.

Le droit PayFit `accounting:read` fournit un journal comptable. Il ne suffit pas à reconstruire tous les contrats, ETP, affectations et événements individuels. Les informations absentes doivent provenir de données RH complémentaires autorisées ; elles ne sont pas déduites d'une simple ventilation comptable.

### Alimentation du socle — demande complémentaire du 15 octobre 2026

Quatre exigences en priorité **P0** complètent le lot **R0**. Leur premier socle de préparation est désormais livré et leur statut reste **partiel** : la revue de rapprochement et sa référence de travail sont disponibles ; leur validation métier et l’activation de nouvelles sources dans les KPI restent à terminer. La couverture actuelle du journal comptable et les réglages existants restent conservés.

| Exigence | Source prévue | Résultat attendu | Droit de lecture à prévoir |
|---|---|---|---|
| **RH-BUD-029 — Import DSN** | Fichiers DSN natifs NEODeS fournis par l’utilisateur. | Alimenter le réalisé social et son historique : personnes/contrats, rémunérations, cotisations, quotités, activité et événements, dans la limite des rubriques effectivement présentes et rapprochées. | Import privé de fichiers ; aucun droit API DSN supposé. |
| **RH-BUD-030 — Collaborateurs PayFit** | Liste paginée et données utiles des collaborateurs de la société autorisée. | Référentiel de personnes avec identifiants stables, correspondances contrôlées et instantanés datés. | `collaborators:read`. |
| **RH-BUD-031 — Contrats PayFit** | Contrats, dont les données françaises utiles et les informations horaires contractuelles autorisées. | Contrats distincts des personnes, dates/statuts/quotités disponibles, unités explicites et couverture historique signalée. | `contracts:read` ; `contracts:time-information:read` pour les champs qui le nécessitent, après vérification et accord d’activation. |
| **RH-BUD-032 — Temps PayFit** | Temps par contrat et période de paie, avec pagination. | Temps payé/effectif et unité tels que renvoyés, rapprochement au contrat et comparaison avec la DSN avant tout indicateur dérivé. | `time:read`. |

**Références techniques vérifiées le 15 octobre 2026.** Les [collaborateurs](https://developers.payfit.io/reference/get_collaborators), [contrats français](https://developers.payfit.io/reference/get_contracts_fr) et [temps par contrat](https://developers.payfit.io/reference/get_contracts_worked_time) sont des lectures distinctes dans la documentation PayFit. La liste des contrats français documente les contrats actifs, en préparation et une fenêtre limitée de contrats archivés (« last year » dans la documentation) ; elle ne garantit pas une photographie complète de toute année passée. Les instantanés doivent donc porter une date d’extraction et une couverture vérifiée. Les champs et droits détaillés restent à revalider lors du développement. [Authentification et scopes](https://developers.payfit.io/docs/authentication-via-api-key).

La [norme DSN NEODeS](https://www.net-entreprises.fr/declaration/norme-et-documentation-dsn/) structure les données de paie et les événements. L’import devra reconnaître la version de norme et les rubriques effectivement prises en charge. Les DSN ne fournissent pas les hypothèses d’embauche ou d’augmentation futures : celles-ci restent dans les scénarios.

#### Parcours d’import et de lecture attendu

1. Choisir les fichiers DSN ou le périmètre API autorisé, puis identifier société, établissement, période et couverture avant application.
2. Prévisualiser les sources, volumes, doublons, remplacements, champs manquants et écarts avec la référence courante.
3. Valider les correspondances personne/contrat, contrôler montants et temps, puis accepter ou annuler l’intégration entière. Aucune publication partielle silencieuse.
4. Conserver une version de source, sa provenance, son empreinte et son statut ; actualiser le réalisé seulement après validation prévue par les habilitations.
5. Consulter la lecture source ou ajustée, avec les écarts résiduels et les paramètres de gestion antérieurs conservés.

#### Contrôles de recette du socle

- **DSN et versions** : contrôler norme, encodage pris en charge, établissement/SIRET, période, nature/type, numéro d’ordre et fraction lorsqu’ils existent. Distinguer doublon exact, déclaration distincte, correction et annule/remplace ; ne pas additionner toutes les versions ou fractions comme si elles étaient interchangeables. Un dossier incomplet reste signalé.
- **Rattachement temporel** : conserver séparément mois de déclaration, période d’emploi et période de rattachement des rémunérations ou régularisations. Une correction rétroactive ne crée pas une deuxième rémunération courante.
- **Identité et correspondances** : utiliser une table de correspondance contrôlée entre identifiants DSN et PayFit, avec preuves et validité. Une homonymie ou une réembauche n’est pas résolue automatiquement par le nom ; un contrat simultané reste distinct. Les correspondances douteuses attendent revue.
- **Rapprochement des sources** : fixer par champ et période la source retenue, son état et sa priorité. DSN, API RH et journal comptable sont rapprochés avant utilisation ; les mêmes salariés, temps ou coûts ne sont pas additionnés entre sources. Un écart documenté reste visible, sans compensation artificielle. DSN et API sont des sources complémentaires ; elles ne sont pas toutes deux obligatoires pour un champ déjà justifié.
- **Temps et ETP** : conserver unité, temps payé, temps effectif et quotité comme notions distinctes. L’ETP contractuel et l’ETP d’activité utilisent des définitions et dénominateurs documentés. Aucun total de temps renvoyé ne devient automatiquement un ETP ou une mesure légale d’effectif.
- **API** : parcourir toutes les pages, rapprocher les identifiants stables, conserver les extractions datées et leur couverture. Une erreur, une limitation ou une page absente ne devient jamais une liste vide validée ; l’ancienne source validée reste disponible. Les relances sont bornées et respectent les délais de limitation.
- **Paramètres de gestion** : préserver les budgets, simulations, commentaires et ajustements manuels ; signaler les éventuels conflits de priorité. L’extourne reste séparée et appliquée une seule fois. Aucune source ne modifie silencieusement une référence figée ou un scénario.
- **Données et accès** : prévoir les champs strictement utiles, les droits côté serveur, les identifiants internes et les masquages nécessaires. Les secrets restent côté serveur ; ni clés ni réponses individuelles brutes dans les journaux d’erreur ou les exports du catalogue. La conservation des fichiers bruts et des données normalisées doit être définie avant mise en service.
- **Portée de la demande** : aucune écriture, clôture, déclaration ou transmission à PayFit ; aucun accès bancaire ou nouveau droit personnel élargi activé par ce document. Les éventuelles extensions de lecture seront présentées et autorisées lors de leur activation.

### Champs minimaux

- Version : ID, titre, type (budget/révisé/variante), état de préparation ou gel, horizon, date de bascule, source de référence, lecture source/ajustée, auteur et horodatage.
- Poste / contrat : ID stable, statut réel ou prévisionnel, société, établissement, service et axes disponibles, type de contrat, dates de début/fin, quotité, rémunération et unité, nombre de mois de paiement, variables documentées.
- Événement : ID, cible, nature, date d'effet, valeur et unité, motif, hypothèse source et version. Deux événements incompatibles sur une même date exigent une résolution explicite.
- Hypothèse : périmètre, période d'application, assiette, taux ou montant, priorité et provenance. Une surcharge société remplace ou complète une règle selon un mode explicite.
- Exécution : ID de version et empreinte des entrées, version du moteur, période, contrôles, statut de calcul et résultats. Un échec ne doit pas publier un résultat partiellement recalculé.

### Invariants obligatoires

- Les euros sont calculés avec une règle de précision explicite ; le modèle monétaire doit préserver les centimes. L'arrondi d'affichage n'altère pas les calculs.
- Les flux monétaires mensuels s'additionnent. Un effectif de fin de mois est un stock et ne s'additionne pas comme un coût. L'ETP moyen dépend d'une période et d'un dénominateur affichés ; une moyenne annuelle sur 12 mois exige 12 mois couverts.
- Une absence de donnée n'est jamais remplacée implicitement par zéro. Une division par une base nulle produit un écart relatif indisponible et conserve l'écart en valeur.
- Les proratas distinguent jours calendaires, jours travaillés, quotité et présence. La règle retenue doit être visible, documentée et vérifiable aux bornes d'entrée/sortie.
- Les taux de charges et constantes doivent être sourcés, datés et modifiables. Aucun coût employeur ne doit être inventé à partir du brut lorsque les paramètres nécessaires sont absents.
- Les ajustements déjà retenus restent isolés. L'extourne de janvier 2026 [montants réels retirés de la copie versionnée] s'applique une seule fois dans la lecture ajustée, sans personne ni ETP, sans ventilation inventée et sans reprise sur 2025.
- Une reclassification d'indemnité ne doit pas ajouter une deuxième fois un montant déjà inclus. Toute simulation de départ demeure distincte de l'événement réellement observé.
- Même référence, mêmes règles et même version du moteur donnent les mêmes résultats. Une duplication crée une variante indépendante ; une version figée ne change pas à la synchronisation suivante.
- Un pont d'écarts doit vérifier : départ + contributions + résiduel explicitement non expliqué = arrivée. L'ordre des effets est documenté pour éviter le double comptage des événements qui se recouvrent.

## 6. Priorités et lots proposés

| Lot | Contenu | Condition de sortie |
|---|---|---|
| **R0 — Références et versions** | Import DSN, lectures API PayFit collaborateurs/contrats/temps, rapprochement et couverture ; référence figée, identité poste/contrat, axes datés, séparation source/ajustements, contrôles et traçabilité. | Données nécessaires identifiées, écarts de rapprochement visibles, aucune perte de réglage ni écrasement historique. |
| **R1 — Moteur et hypothèses** | Rubriques et règles déterministes, calendrier/prorata, matrice mensuelle globale, surcharges société, exécutions contrôlées. | Cas de calcul vérifiés sur des exemples de test, reproductibilité et agrégations exactes ; paramètres manquants bloquants. |
| **R2 — Construction du budget** | Changements datés, départs, embauches, vacances/remplacements, événements de rémunération, enveloppes service/rubrique, saisie en masse. | Aperçu avant application, scénarios indépendants, conservation des cibles et gestion des conflits. |
| **R3 — Comparaisons et explication** | Explorateur mensuel, trois versions, détail des écarts, cascade et exports contextuels. | Synthèse = détail = export ; périodes et lectures explicites ; résiduel jamais masqué. |
| **R4 — Extensions à qualifier** | BDESE, index F/H, menus périphériques, multidevise et agent modélisateur local. | Données, règles, usages et périmètres définis avant engagement. Aucune conformité déduite des captures. |

**P0** désigne une base de fiabilité indispensable ; **P1**, les principaux usages budgétaires ; **P2**, les extensions. L'ordre final dépend de la disponibilité des sources et des décisions métier. Le référentiel est préparé en R0 et doit être utilisable avant la mise en service du moteur qui le requiert.

Le premier ensemble fonctionnel recommandé après ce cadrage est **R0 puis R1**, sur un périmètre vérifiable, avant les saisies individuelles et les comparaisons avancées. Ce document ne vaut pas activation de ces outils.

## 7. Règles d'interface

Conserver les 10 vues et les informations actuelles de Studio RH. Ajouter un espace Budget avec une progression simple : référence → hypothèses → mouvements → résultats → écarts. Éviter les grands menus denses du modèle observé ; conserver des filtres persistants et un récapitulatif de contexte, puis des panneaux de détail.

- Contexte toujours visible : version(s), année, mois couverts, lecture source/ajustée, société/service, unité et dernier calcul valide.
- Choix de métrique : ETP, effectif de fin de mois, entrées, sorties, brut, charges, coût employeur et rubriques disponibles ; ne pas mélanger leurs agrégations.
- Axes proposés seulement quand les sources les renseignent. Un résultat global issu du journal PayFit ne devient pas un détail salarié ou service.
- Tableaux avec recherche, tri, synthèse/détail et regroupements ; graphiques sobres, infobulles contextualisées et bascule empilé/groupé lorsque cela a du sens.
- Saisie avec date, unité et assiette ; prévisualisation des cellules ou personnes touchées ; validation groupée ou annulation sans effet partiel.
- Exports calculés reprenant exactement les filtres, unités, lectures et versions affichés. Le classeur compagnon historique actuellement proposé reste clairement identifié tant qu'un export calculé n'est pas développé.

## 8. Validation et indicateurs de réussite

| Contrôle | Résultat attendu |
|---|---|
| Préservation | Rapport source, journaux réels, paramètres et ajustements antérieurs inchangés par la consultation du catalogue. |
| Calculs temporels | Entrées/sorties en début et fin de mois, années bissextiles, changements de quotité et de salaire testés avec règles explicites. |
| Précision | Aucun écart de centime non expliqué entre détail, agrégats et export ; arrondis documentés. |
| Scénarios | Une modification n'affecte que la variante visée ; gel et référence résistent à une actualisation de source. |
| Couverture | Toute donnée ou hypothèse obligatoire manquante déclenche une alerte précise ; aucun remplissage silencieux. |
| Analyse | Chaque contribution d'écart est traçable ; égalité du pont avec un résiduel identifié si nécessaire. |
| Ergonomie | Navigation clavier, filtres combinés et lecture mobile utilisables ; aucun écran actuel perdu. |
| Confidentialité | Accès individuel par propriétaire aujourd'hui ; futurs droits testés avant ouverture d'un périmètre d'équipe. |

Le temps nécessaire pour créer une première variante, la part d'écarts expliqués et le taux d'erreurs bloquantes pourront être mesurés après un pilote. Les valeurs de départ et objectifs chiffrés restent à établir ; aucune promesse de réduction de cycle n'est tirée du webinaire.

## 9. Décisions encore nécessaires avant développement

- Horizon du premier budget : année civile suivante seulement ou révisé courant + budget suivant ; date exacte de référence à figer.
- Pour les sources prévues DSN et API PayFit : premiers SIRET/mois à couvrir, disponibilité des fichiers historiques, limites d’archive, clés de rapprochement et durées de conservation. Le choix de les prévoir est acquis ; l’activation des accès restera une étape distincte.
- Rubriques de coût retenues, assiettes d'augmentation, articulation AG/AI, échéancier du variable et coûts de départ à paramétrer.
- Règles de prorata et niveau d'analyse requis pour chaque population.
- Arbitrage entre enveloppe globale et saisies individuelles : enveloppe cible, plafond ou allocation ; traitement des écarts de somme.
- Sens métier précis de « Hypothèses rapprochées », « Publisher », « Pointage » et « Tree-View », seulement visibles dans les commandes ou menus.
- Périmètre BDESE/index F/H et besoin multidevise. Leur présence dans un menu ne fournit pas les règles de calcul ou obligations applicables.

L'agent modélisateur demeure une exigence future : proposer structures, règles et variantes sur le Mac, calculer via le moteur déterministe, présenter les impacts vérifiés et soumettre l'application à validation humaine. Il ne remplace ni les sources ni les contrôles.

## 10. Livraison de cadrage

- 21 captures identifiées et analysées, sans copie de pixels ni reprise des noms et montants de démonstration.
- 32 exigences structurées : les 28 exigences initiales et les 4 exigences d’alimentation DSN / API RH, avec état actuel, critères, dépendances et références.
- Catalogue RH séparé du catalogue Pigment, consultable en lecture seule dans la feuille de route privée ; recherche, filtres, détails et exports.
- Complément daté ajouté au cahier des charges social, avec conservation de sa version précédente.
- Aucun nouveau moteur budgétaire, nouvelle connexion, permission ou synchronisation activé par ce cadrage.

## Suite des contrôles de septembre

La qualification de gestion N/S est consignée séparément des montants et des instantanés activés. Un onglet Temps & quotités contrôle les unités, périodes, lignes multiples et valeurs manquantes ; les observations numériques restent distinctes de la validation métier des temps. Voir le [lot 4](studio-rh-lot4-temps-2026-10-15.md).

## ETP contractuels de fin septembre

Le [lot 5](studio-rh-lot5-etp-2026-10-15.md) active une source ETP contractuelle de fin de mois, fondée sur les contrats DSN et un classement CSV vérifié. Il conserve les temps, les ETP d’activité et moyens non revalidés, les saisies et les projections.

## Livraison du 16 octobre — versions et hypothèses agrégées

Le [lot 6](studio-rh-lot6-budget-2026-10-16.md) apporte un atelier indépendant : référence figée, versions et copies, hypothèses mensuelles et registre de calculs reproductibles. Les mois futurs sont des simulations de gestion ; les KPI, les ETP et les ajustements actuels restent conservés. Les rubriques individuelles, mouvements et conventions générales de temps restent au programme.

## Livraison du 16 octobre — mouvements prévisionnels

Le [lot 7](studio-rh-lot7-mouvements-2026-10-16.md) ajoute des embauches et départs par version, avec conventions de dates, quotité, coûts récurrents et ponctuels, détail mensuel et contrôle de présence des salaires dans la base. Les sources, les plans T4, les KPI et les ajustements existants restent conservés.
