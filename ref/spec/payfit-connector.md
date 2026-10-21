# Connecteur PayFit — premier branchement de lecture

Connecteur activé sur Clair privé le 14 octobre 2026. Connexion et lecture réelles vérifiées à **16 h 09 (Europe/Paris)**.

## Ce que cette version réalise

La page **Sources RH** (`#payfit`) vérifie la configuration, teste l’autorisation de la clé auprès de PayFit et propose la lecture d’un journal comptable mensuel. Elle présente les comptes, débits, crédits, soldes, le statut de la paie, la période, la date de lecture et l’empreinte de la source. L’aperçu peut être exporté en JSON ou en CSV par compte.

Depuis le 15 octobre 2026, la commande **Rapprocher et alimenter Studio RH** conserve les journaux dans D1 et active leurs agrégats comptables contrôlés. Chaque mois garde sa source, son empreinte, la date de lecture et la version du mapping. Le rapport fourni, les réglages personnels et le modèle financier sont conservés séparément.

Les KPI de brut de gestion, cotisations et coût chargé peuvent utiliser PayFit au total entreprise, toutes populations. Les filtres de service ou de catégorie de contrat gardent les données CSV/DSN et une mention explicite de leur source. Les codes analytiques API sont disponibles, mais leur rapprochement avec les catégories de contrat n’est pas encore activé. Les effectifs et ETP gardent leurs sources propres.

La configuration d’une clé ne prouve pas une connexion : seule une réponse positive du test réel donne l’état « Connexion vérifiée ». Les tests simulés sont indiqués comme fixtures et ne donnent jamais un état connecté réel.

## Lecture réelle vérifiée

Le test de connexion et l’aperçu ont réussi en production sur le site privé Clair avec le périmètre suivant :

| Contrôle | Résultat constaté |
| --- | --- |
| Société | Groupe MiiMOSA |
| Autorisation | `accounting:read` uniquement |
| Période demandée | Septembre 2026 (`202609`) |
| Statut de paie | `completed` — paie clôturée |
| Journal comptable v2 | 646 lignes, 27 comptes |
| Mode | Lecture seule ; aperçu et exports |

Cette vérification établit l’accès au journal de ce mois. Les autres périodes et les futures extensions seront contrôlées séparément. La source PayFit, le rapport fourni dans Studio RH et les ajustements personnels restent des couches distinctes. Le statut de paie clôturée n’atteste ni le dépôt d’une DSN ni le paiement des salaires.

## Accès constaté et prérequis

L’accès administrateur MiiMOSA à **Intégrations → Accès API** a été vérifié le 14/10/2026. Les scopes `accounting:read`, `collaborators:read`, `contracts:read`, `contracts:time-information:read`, `time:read` figuraient parmi les droits proposés.

Premier périmètre : clé dédiée au connecteur Clair avec **`accounting:read` uniquement**. Cette clé a été créée le 14/10/2026 après accord explicite, puis configurée comme secret sur Clair privé. Le test de connexion et la lecture de septembre 2026 ont été vérifiés depuis Sources RH. Les droits salariés, contrats et temps sont des extensions futures ; les droits d’écriture, bancaires et d’identité personnelle ne sont pas nécessaires à cette version.

La [documentation d’authentification client](https://developers.payfit.io/docs/authentication-via-api-key) prévoit une clé propre à la société. Le programme OAuth partenaire n’est pas nécessaire pour ce raccordement personnel. La [grille publique des offres](https://payfit.com/fr/nos-offres/) réserve actuellement l’accès API à certaines offres ; le contrat historique MiiMOSA n’a pas été vérifié. Un écran accessible ne garantit pas que chaque endpoint ou période soit disponible.

## Configuration protégée

Deux valeurs runtime sont requises :

| Valeur | Contenu | Stockage |
| --- | --- | --- |
| `PAYFIT_API_KEY` | Clé de société PayFit avec `accounting:read` | Secret Sites côté serveur |
| `PAYFIT_OWNER_ID` | ID de visiteur vérifié propre au site Clair | Configuration Sites côté serveur, conservée comme secret |

L’identifiant de visiteur diffère de l’identifiant de compte de la politique de partage Sites. Avant configuration, le statut et la procédure repliée de Sources RH affichent `viewerBindingId` pour le visiteur authentifié. Après configuration, cette valeur n’est plus exposée ; tout autre visiteur est refusé avant un appel à PayFit.

Le site doit conserver son audience personnelle privée. La clé est saisie hors du chat et ajoutée avec l’outil natif Sites de variables d’environnement, avec `is_secret: true`. Déployer ensuite la version sauvegardée pour appliquer la nouvelle révision d’environnement. Ne pas placer de clé dans le code, le bundle navigateur, le manifeste, les logs, la feuille de route ou les exports.

[.env.example](../.env.example) documente uniquement les noms de configuration. Le fichier ne contient aucune valeur réelle. Les fichiers `.env*` sont ignorés par Git sauf cet exemple. Le serveur local ne charge pas automatiquement une clé ; les tests injectent des réponses fictives et l’adaptateur fournit sa propre identité loopback.

## API Clair

| Route | Méthode | Fonction |
| --- | --- | --- |
| `/api/payfit/status` | GET | État de configuration locale, sans appeler PayFit |
| `/api/payfit/test` | POST, JSON `{}` | Introspection de la clé et lecture des informations de société |
| `/api/payfit/preview` | POST, JSON `{"month":"2026-09"}` | Statut de paie et journal comptable du mois demandé |
| `/api/payfit/rh` | GET | Agrégats rapprochés actifs et provenance, sans lignes nominatives |
| `/api/payfit/sync` | POST, JSON `{"month":"2026-09","revision":0}` | Nouvelle lecture serveur, contrôles, conservation de la source et activation conditionnelle |

Les routes exigent l’identité vérifiée ; les POST exigent une origine identique et un petit corps JSON. Aucune URL, société cible, clé ou méthode PayFit n’est choisie par le navigateur. Les endpoints et la société identifiée par introspection sont sélectionnés côté serveur. Absence de clé ou propriétaire configuré : lecture indisponible. Mauvais propriétaire : accès refusé avant transmission.

Les appels à PayFit sont limités à l’introspection de lecture `POST https://oauth.payfit.com/introspect`, puis les GET de société, statut de paie et journal v2 sous `https://partner-api.payfit.com/companies/{companyId}/...`. Le fetch natif est lié à `globalThis` pour Cloudflare Workers. Le mode `redirect: manual` refuse explicitement toute réponse 3xx, sans lire ni suivre sa destination ; les réponses sont bornées. Les erreurs ne contiennent ni clé ni réponse brute de PayFit. Une limitation 429 conserve le délai utile sans relance automatique ; un échec ne devient pas un journal vide réussi.

Les réponses et le navigateur utilisent `private, no-store`. Les aperçus précédents sont conservés et clairement signalés comme non actualisés après échec. Les exports portent sur l’aperçu effectivement obtenu, avec sa période et sa provenance. Une synchronisation de contenu inchangé ne crée aucune révision supplémentaire. Un conflit de révision refuse l’activation ; un mois bloqué ne remplace pas un mois actif valide.

Le journal normalisé est conservé dans une table immuable, au maximum 1 Mio par journal. Les agrégats forment des révisions distinctes, liées au propriétaire et à une seule société. Aucun journal ni montant client ne peut être soumis directement pour activation. La requête serveur relit PayFit et effectue le mapping elle-même.

## Interprétation du journal

Le [journal v2](https://developers.payfit.io/reference/get_companyaccountingv2) est un ensemble de lignes comptables : date d’opération, compte, débits/crédits, codes analytiques et, selon le paramétrage, salarié/contrat. Il ne fournit pas directement un indicateur certifié « salaire brut » ou « coût employeur ».

Les soldes d’aperçu suivent **débit − crédit**. Ils ne sont pas automatiquement convertis aux conventions du P&L financier de Clair. Une ligne absente n’est pas une ligne à zéro ; des montants inconnus doivent rester visibles. Un total comptable incluant les contreparties peut être nul, sans constituer une masse salariale nulle.

Le statut de paie **completed** et la date de fin d’exécution sont des informations de l’API ; ils n’attestent pas une DSN déposée ni le paiement des salaires. Une paie **not_completed** reste identifiée comme telle.

Le [changelog PayFit](https://developers.payfit.io/changelog/retroactive-generation-of-accountingv2-fr-documents) annonce la génération des documents disponibles des 24 derniers mois à l’activation de `accounting:read` pour les sociétés françaises. La disponibilité réelle doit être contrôlée mois par mois. Les noms, contrats et codes analytiques dépendent du paramétrage des exports comptables.

## Rapprochement et ajustements Studio RH

Le mapping reprend les règles du script source fourni `actualisation_payfit/extract_payfit.py` : brut 6411/6413, cotisations 6451/6453/6455 et taxes 63, autres éléments 6414/6417/758, titres-restaurant 6476, provisions 6412000/6485000. Les dettes sont rapprochées séparément ; les contreparties 4282000/4382000 ne deviennent pas des décaissements. Le coût chargé et les charges de personnel incluant provisions et éléments annexes restent deux indicateurs distincts.

Les indemnités RC rapprochées aux DSN sont reclassées une fois de 6414 vers le brut de gestion, sans doubler les cotisations déjà incluses. Les écarts avec le brut CSV restent visibles : ils ne sont ni compensés artificiellement ni automatiquement qualifiés d’avantage en nature.

Une source non clôturée, vide, déséquilibrée, hors période, comportant un compte inconnu ou un montant impossible à calculer ne peut pas alimenter les KPI. Une source liée à un autre SIREN que celui du rapport est refusée.

La lecture **MS après extournes** conserve l’instruction documentée du 7 octobre : janvier 2026 [montants réels retirés de la copie versionnée]. Elle s’applique une seule fois au total entreprise et au total salarial sans ventilation par service ou catégorie de contrat, avec zéro personne et zéro ETP. La lecture **Paie source** permet de revenir aux montants avant cette extourne. Les journaux et décaissements restent en source. Les hypothèses individuelles et les références des prévisions T4 sont conservées.

Les 14 clés de paramètres antérieures sont conservées. Une quinzième clé indépendante enregistre uniquement le choix de source et de lecture ; elle est écrite lors d’une sélection de l’utilisateur. Le HTML et le classeur sources ne sont pas modifiés.

Les lectures collaborateurs, contrats et temps peuvent ensuite enrichir les effectifs et hypothèses, avec leurs scopes et limites documentées. Des temps travaillés, une liste de personnes ou une quotité contractuelle ne suffisent pas à certifier à eux seuls l’ETP mensuel de toutes les périodes.

## Références officielles

- [Authentification API client](https://developers.payfit.io/docs/authentication-via-api-key)
- [Démarrage API client](https://developers.payfit.io/docs/start-with-payfit-api)
- [Journal comptable v2](https://developers.payfit.io/reference/get_companyaccountingv2)
- [Statut de paie](https://developers.payfit.io/reference/get_companypayrollstatus)
- [Limites d’appels](https://developers.payfit.io/docs/rate-limits)
- [Spécification OpenAPI](https://developers.payfit.io/openapi/partner-api.json)
- [Offres PayFit France](https://payfit.com/fr/nos-offres/)



## Complément prévu : DSN et lectures RH — 15 octobre 2026

À la demande de Lyes, le [cahier des charges Studio RH](studio-rh-budget-spec-2026-10-15.md) et sa feuille de route prévoient quatre compléments du lot R0, tous au statut **Prévu** :

- **RH-BUD-029** : import de fichiers DSN, versionnés et prévisualisés, avec contrôles des périodes, établissements, fractions, remplacements et doublons.
- **RH-BUD-030** : lecture des collaborateurs (`collaborators:read`), pagination, identifiants stables et instantanés datés.
- **RH-BUD-031** : lecture des contrats (`contracts:read`) et, selon les champs nécessaires, informations horaires contractuelles (`contracts:time-information:read`), avec limites d’historique explicites.
- **RH-BUD-032** : lecture des temps par contrat et mois (`time:read`), unités et couverture, sans conversion implicite en ETP.

L’import DSN et les lectures RH devront rapprocher leurs données avec le journal comptable et la référence existante, sans double comptage ni écrasement des ajustements. Une source historique indisponible reste manquante ; un état courant n’est pas présenté comme une photographie passée. Les sources peuvent se compléter sans être toutes obligatoires pour un champ déjà justifié.

Ce complément ne modifie ni la clé ni ses autorisations, les secrets, les appels du connecteur actuel ou les données stockées. L’activation de droits supplémentaires et les premiers imports seront traités séparément du présent cadrage. Les références techniques et critères détaillés figurent dans les quatre exigences et dans la section « Alimentation du socle » du cahier.
