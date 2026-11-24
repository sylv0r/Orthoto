# --- 1. LanguageTool, stripped down to French + English -----------------------
FROM erikvl87/languagetool:6.8 AS lt
USER root
COPY docker/language-module.properties /LanguageTool/META-INF/org/languagetool/language-module.properties
# Remove the data (dictionaries, rule files) of every other language. Java classes
# are kept so that nothing breaks at class-loading time. es/ca/pt keep their
# common_words.txt, needed by the language detector.
RUN set -eu; \
    cd /LanguageTool/org/languagetool; \
    for d in resource/*/ rules/*/ tagging/*/ synthesis/*/ tokenizers/*/; do \
      case "$(basename "$d")" in \
        fr|en|disambiguation) ;; \
        es|ca|pt) find "$d" -type f ! -name '*.class' ! -name common_words.txt -delete ;; \
        *) find "$d" -type f ! -name '*.class' -delete ;; \
      esac; \
    done; \
    find . -type d -empty -delete; \
    cd /LanguageTool/libs; \
    rm -f asturian-pos-dict.jar catalan-pos-dict.jar dutch-pos-dict.jar german-pos-dict.jar \
          languagetool-ga-dicts.jar lucene-gosen-ipadic.jar hanlp.jar morfologik-crh-lt.jar \
          morfologik-ukrainian-lt.jar morphology-el.jar portuguese-pos-dict.jar spanish-pos-dict.jar \
          languagetool-core-tests.jar junit.jar hamcrest-core.jar; \
    rm -f /LanguageTool/config.properties /LanguageTool/start.sh /LanguageTool/*.bat /LanguageTool/*.sh \
          /LanguageTool/languagetool.jar /LanguageTool/languagetool-commandline.jar

# --- 2. Minimal Java runtime (jlink) -----------------------------------------
FROM eclipse-temurin:21-jdk-alpine AS jre
COPY --from=lt /LanguageTool /lt
RUN set -eu; \
    mods="$(jdeps --ignore-missing-deps -q --multi-release 21 --print-module-deps \
              --class-path '/lt/libs/*' /lt/languagetool-server.jar /lt/libs/languagetool-core.jar /lt)"; \
    echo "modules: $mods"; \
    jlink --add-modules "$mods,jdk.crypto.ec,jdk.localedata,jdk.zipfs,jdk.charsets" \
          --include-locales=en,fr --strip-debug --no-man-pages --no-header-files \
          --compress=zip-6 --output /jre

# --- 3. Final image: JRE + LanguageTool + nginx + front ------------------------
FROM alpine:3.22
RUN apk add --no-cache nginx tini \
 && adduser -D -H -u 10001 app
COPY --from=jre /jre /opt/jre
COPY --from=lt /LanguageTool /opt/lt
COPY docker/server.properties /opt/lt/server.properties
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/entrypoint.sh /entrypoint.sh
COPY web/ /srv/
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh
ENV PATH=/opt/jre/bin:$PATH \
    AUTH_USER=admin \
    JAVA_XMX=512m
USER app
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -q -O /dev/null http://127.0.0.1:8010/v2/languages || exit 1
ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
