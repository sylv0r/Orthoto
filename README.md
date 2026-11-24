# orthoto

Correcteur d'orthographe et de grammaire **FR / EN**, auto-hébergé, en un seul conteneur Docker.

Colle ton texte, appuie sur **Entrée**, et la version corrigée s'affiche dessous, prête à copier.
Aucune reformulation : seules les fautes sont corrigées, les suggestions de style sont ignorées
et un texte sans faute ressort identique.

- Moteur : [LanguageTool](https://github.com/languagetool-org/languagetool) 6.8 (LGPL), basé sur
  des règles, pas sur un LLM.
- Front : HTML + JS sans framework ni build, environ 10 Ko.
- Auth : HTTP Basic Auth, la fenêtre login/mot de passe native du navigateur.
- Image : environ 200 Mo, environ 500 Mo de RAM, prête en environ 2 s et chaude en environ 10 s.

## Démarrer

```sh
cp .env.example .env        # puis choisis un vrai mot de passe dans .env
docker compose up -d --build
```

Ouvre ensuite <http://ton-serveur:8080>. Le navigateur demande l'identifiant (`moi` par défaut)
et le mot de passe. Enregistre-les dans le gestionnaire de mots de passe : la fenêtre sera
pré-remplie ensuite.

Sans compose :

```sh
docker build -t orthoto .
docker run -d --name orthoto --restart unless-stopped -p 8080:8080 \
  -e AUTH_PASSWORD='un-vrai-mot-de-passe' orthoto
```

| Variable        | Défaut | Rôle                                                              |
|-----------------|--------|-------------------------------------------------------------------|
| `AUTH_USER`     | `moi`  | identifiant Basic Auth                                            |
| `AUTH_PASSWORD` | aucune | mot de passe ; si absent, un mot de passe aléatoire est affiché dans `docker logs` |
| `JAVA_XMX`      | `512m` | mémoire max de la JVM LanguageTool                               |

> Le conteneur sert du HTTP sur le port 8080. Sur ton réseau local, ça suffit. Pour y accéder
> depuis l'extérieur, mets-le derrière un proxy HTTPS (Caddy, Traefik, Nginx Proxy Manager, ou un
> Cloudflare Tunnel) : en HTTP, le mot de passe transite en clair.

## Utilisation

- **FR / EN** : bascule au-dessus du champ (FR par défaut). Changer de langue relance la correction.
- **Entrée** pour corriger, **Maj+Entrée** pour un saut de ligne.
- Les corrections sont surlignées en vert. **Clic** sur une correction : alternative suivante,
  puis texte d'origine. Le pointillé orange signale une faute sans suggestion, laissée telle quelle.
- **Copier** copie le texte tel qu'il est affiché.

## Comment c'est rendu rapide et léger

Avec l'image LanguageTool par défaut, le français prend environ 900 ms par requête et l'ensemble
occupe 1,4 Go de RAM. Les optimisations :

- `pipelineCaching=true` (désactivé par défaut) : le pipeline FR n'est plus reconstruit à chaque requête.
- Cache de résultats par phrase (`cacheSize`) : une phrase déjà vue revient en environ 10 ms.
- Seuls le FR et l'EN sont chargés. Les dictionnaires et règles des autres langues, ainsi que fastText
  (131 Mo), sont retirés de l'image.
- JRE minimal construit avec `jlink` (environ 60 Mo).
- Pas de keep-alive entre nginx et LanguageTool : son serveur HTTP Java ajoute environ 45 ms sur une
  connexion réutilisée.
- Chauffe FR/EN au démarrage, pour que la première vraie requête soit déjà rapide.

Mesures en local, via nginx et l'auth :

| Cas                            | Latence     |
|--------------------------------|-------------|
| FR, texte déjà vu              | ~10–15 ms   |
| FR, texte nouveau              | ~30–75 ms   |
| EN                             | ~10–25 ms   |
| FR, environ 2 500 caractères   | ~55 ms      |

Les résultats sont identiques à ceux de l'image LanguageTool complète (vérifié sur un corpus FR/EN).

## Structure

```
Dockerfile              build multi-étapes : LanguageTool allégé → JRE jlink → Alpine + nginx
docker/entrypoint.sh    mot de passe, lancement de LanguageTool et nginx, chauffe, supervision
docker/nginx.conf       Basic Auth, fichiers statiques, proxy /v2 → LanguageTool (127.0.0.1:8010)
docker/*.properties     configuration LanguageTool (cache, langues)
web/                    front (index.html, style.css, app.js, core.js)
tests/                  tests de la logique de correction (npm test)
```

## Tests

```sh
npm test
```
