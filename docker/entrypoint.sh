#!/bin/sh
set -eu

AUTH_USER="${AUTH_USER:-moi}"
if [ -z "${AUTH_PASSWORD:-}" ]; then
  AUTH_PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=')"
  echo "[orthoto] AUTH_PASSWORD non défini, mot de passe généré pour '$AUTH_USER' : $AUTH_PASSWORD"
fi
printf '%s:%s\n' "$AUTH_USER" "$(printf '%s' "$AUTH_PASSWORD" | mkpasswd -m sha512 -P 0)" > /tmp/htpasswd
unset AUTH_PASSWORD
mkdir -p /tmp/nginx

cd /opt/lt
java -Xms64m -Xmx"${JAVA_XMX:-512m}" -XX:+UseSerialGC \
  -cp languagetool-server.jar org.languagetool.server.HTTPServer \
  --port 8010 --config /opt/lt/server.properties &
JAVA_PID=$!

nginx -e /dev/stderr -c /etc/nginx/nginx.conf -g 'daemon off;' &
NGINX_PID=$!

STOPPING=0
trap 'STOPPING=1; kill -TERM "$JAVA_PID" "$NGINX_PID" 2>/dev/null || true' TERM INT

# Warm-up: load the FR/EN pipelines and let the JIT compile the hot paths,
# so that the very first real request is already fast.
(
  until wget -q -O /dev/null http://127.0.0.1:8010/v2/languages 2>/dev/null; do sleep 0.3; done
  # Every sentence contains $i so that the per-sentence result cache never short-circuits the check.
  i=0
  while [ "$i" -lt 30 ]; do
    wget -q -O /dev/null --post-data "language=fr&text=Le $i mai, je suis aller au marché et j'ai acheter $i pomme. Les enfant $i joue dans le jardin. Ces une idée numéro $i, merci beaucoups. Elle s'est rendue compte que les résultats $i qu'elle avait obtenus étaient faux. Si j'aurais su $i, je serais venu. Leurs voitures $i sont garé devant la maison. Je vous envoie ci-joint $i documents, pouvez vous répondre ? Elle sont $i belles et ils a raison." http://127.0.0.1:8010/v2/check || true
    wget -q -O /dev/null --post-data "language=en-US&text=On day $i I has went to the store and buyed $i apple. Their going to park $i tomorow. Its idea $i. She could of done it $i times. He go to school $i days, these book is mine and she don't like it." http://127.0.0.1:8010/v2/check || true
    i=$((i + 1))
  done
  echo "[orthoto] prêt"
) &

while kill -0 "$JAVA_PID" 2>/dev/null && kill -0 "$NGINX_PID" 2>/dev/null; do
  sleep 1
done
kill -TERM "$JAVA_PID" "$NGINX_PID" 2>/dev/null || true
wait "$JAVA_PID" 2>/dev/null || true
wait "$NGINX_PID" 2>/dev/null || true
[ "$STOPPING" = 1 ] && exit 0
echo "[orthoto] un processus s'est arrêté, sortie" >&2
exit 1
