import { applyI18n } from './legal.js'

// German / Japanese translations of the Support page. Structure and CSS classes
// mirror support.html exactly; only text changes.

const de = {
  __title: 'Support — StatsKey',
  'lp-title': 'Support',
  'lp-date': 'Zuletzt aktualisiert: 2. April 2026',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">Kontakt</h2>
            <div class="glass p-6">
              <p class="mb-2"><strong class="text-text-primary">E-Mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
              <p class="mb-4"><strong class="text-text-primary">Antwortzeit:</strong> Innerhalb von 24–48 Stunden</p>
              <p class="text-[14px] text-text-muted">Für den schnellsten Support gib bitte dein Gerätemodell (z. B. iPhone 15 Pro), die iOS-Version, eine Beschreibung des Problems und ggf. Screenshots an.</p>
            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">Häufig gestellte Fragen</h2>
            <div class="space-y-6">

              <div>
                <h3 class="font-medium text-text-primary mb-1">Wie genau ist die KI-Essensanalyse?</h3>
                <p>Unsere KI liefert Schätzungen auf Basis visueller Analyse und typischer Portionsgrößen. Alle Nährwertangaben sind Näherungswerte und sollten nicht für medizinische oder klinische Zwecke verwendet werden. Für exakte Werte prüfe die Verpackung oder nutze die manuelle Eingabe.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Sind meine Daten sicher?</h3>
                <p>Alle Daten werden bei der Übertragung und im Ruhezustand verschlüsselt. Wir verkaufen deine personenbezogenen Daten niemals. Vollständige Details findest du in unserer <a href="/privacy" class="text-accent hover:underline">Datenschutzerklärung</a>.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Kann ich StatsKey offline nutzen?</h3>
                <p>Kernfunktionen funktionieren offline, einschließlich der Ansicht erfasster Mahlzeiten und Übungen. KI-Analyse und Cloud-Synchronisierung erfordern eine Internetverbindung.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Wie synchronisiere ich mit Apple Health?</h3>
                <p>Gehe zu Einstellungen &rarr; Integrationen &rarr; Apple Health. Erteile Berechtigungen für die Datentypen, die du synchronisieren möchtest. Du kannst diese jederzeit in den Einstellungen deines iPhones ändern.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Wie lösche ich mein Konto?</h3>
                <p>Einstellungen &rarr; Konto &rarr; Konto löschen. Dadurch werden alle deine Daten innerhalb von 30 Tagen dauerhaft von unseren Servern entfernt.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Warum funktioniert die Kamera nicht?</h3>
                <p>Gehe zu iPhone-Einstellungen &rarr; StatsKey &rarr; Kamera aktivieren. Möglicherweise musst du die App nach Erteilung der Berechtigung neu starten.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Warum werden meine Daten nicht synchronisiert?</h3>
                <p>Stelle sicher, dass du mit Apple oder Google angemeldet bist und eine Internetverbindung hast. Versuche Einstellungen &rarr; Synchronisierung erzwingen.</p>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">Fehlerbehebung</h2>
            <div class="grid sm:grid-cols-2 gap-4">

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Lebensmittel nicht erkannt</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Fotos bei gutem Licht aufnehmen</li>
                  <li>Essen mittig im Bild platzieren</li>
                  <li>Unscharfe Fotos vermeiden</li>
                  <li>Das Essen stattdessen per Text beschreiben</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">HealthKit synchronisiert nicht</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Prüfe Einstellungen &rarr; Datenschutz &rarr; Health &rarr; StatsKey</li>
                  <li>Stelle sicher, dass alle Berechtigungen aktiviert sind</li>
                  <li>StatsKey vollständig schließen und neu öffnen</li>
                  <li>iPhone neu starten, wenn das Problem bestehen bleibt</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Anmeldung nicht möglich</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Internetverbindung prüfen</li>
                  <li>Bei Apple: Einstellungen &rarr; Mit Apple anmelden prüfen</li>
                  <li>Bei Google: Gültiges Google-Konto sicherstellen</li>
                  <li>App löschen und neu installieren</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">App stürzt ab</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Auf die neueste Version aktualisieren</li>
                  <li>iPhone neu starten</li>
                  <li>App löschen und neu installieren</li>
                  <li>Support kontaktieren, wenn das Problem bestehen bleibt</li>
                </ul>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">Funktionswünsche &amp; Fehlerberichte</h2>
            <p class="mb-4">Wir freuen uns über dein Feedback. Schreib uns an <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>.</p>
            <div class="grid sm:grid-cols-2 gap-4">
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Funktionswünsche</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Beschreibung der Funktion</li>
                  <li>Wie sie deinem Gesundheitsweg helfen würde</li>
                  <li>Beispiele aus anderen Apps</li>
                </ul>
              </div>
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Fehlerberichte</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Was du getan hast, als es passierte</li>
                  <li>Fehlermeldungen und Screenshots</li>
                  <li>Gerätemodell, iOS-Version</li>
                  <li>Schritte zur Reproduktion des Problems</li>
                </ul>
              </div>
            </div>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">StatsKey ist kein Medizinprodukt und nicht dazu bestimmt, Krankheiten zu diagnostizieren, zu behandeln, zu heilen oder zu verhüten. Alle Nährwertangaben sind Näherungswerte. Konsultiere bei medizinischen Entscheidungen immer medizinisches Fachpersonal. Vollständige Details findest du in unseren <a href="/terms" class="text-accent hover:underline">Nutzungsbedingungen</a> und unserer <a href="/privacy" class="text-accent hover:underline">Datenschutzerklärung</a>.</p>
          </section>
  `,
}

const ja = {
  __title: 'サポート — StatsKey',
  'lp-title': 'サポート',
  'lp-date': '最終更新: 2026年4月2日',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">お問い合わせ</h2>
            <div class="glass p-6">
              <p class="mb-2"><strong class="text-text-primary">メール:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
              <p class="mb-4"><strong class="text-text-primary">応答時間:</strong> 24〜48時間以内</p>
              <p class="text-[14px] text-text-muted">最も迅速なサポートのため、デバイスのモデル（例: iPhone 15 Pro）、iOSのバージョン、問題の説明、該当する場合はスクリーンショットを記載してください。</p>
            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">よくある質問</h2>
            <div class="space-y-6">

              <div>
                <h3 class="font-medium text-text-primary mb-1">AIの食事分析はどのくらい正確ですか？</h3>
                <p>当社のAIは、視覚的な分析と一般的な分量に基づいて推定値を提供します。すべての栄養価は概算であり、医療または臨床の目的で使用すべきではありません。正確な値については、食品のパッケージを確認するか、手動入力をご利用ください。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">私のデータは安全ですか？</h3>
                <p>すべてのデータは、転送中および保存時に暗号化されます。当社がお客様の個人情報を販売することは決してありません。詳細は<a href="/privacy" class="text-accent hover:underline">プライバシーポリシー</a>をご覧ください。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">StatsKeyをオフラインで使えますか？</h3>
                <p>記録した食事や運動の閲覧を含む中核機能はオフラインで動作します。AI分析とクラウド同期にはインターネット接続が必要です。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Apple Healthと同期するには？</h3>
                <p>設定 &rarr; 連携 &rarr; Apple Health に移動します。同期したいデータタイプの許可を与えてください。これらはiPhoneの設定でいつでも変更できます。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">アカウントを削除するには？</h3>
                <p>設定 &rarr; アカウント &rarr; アカウントを削除。これにより、すべてのデータが30日以内に当社のサーバーから完全に削除されます。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">カメラが動作しないのはなぜですか？</h3>
                <p>iPhoneの設定 &rarr; StatsKey &rarr; カメラを有効にする に移動します。許可を与えた後、アプリの再起動が必要な場合があります。</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">データが同期されないのはなぜですか？</h3>
                <p>AppleまたはGoogleでサインインしており、インターネットに接続されていることを確認してください。設定 &rarr; 同期を強制 をお試しください。</p>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">トラブルシューティング</h2>
            <div class="grid sm:grid-cols-2 gap-4">

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">食べ物が認識されない</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>明るい場所で撮影する</li>
                  <li>食べ物をフレームの中央に置く</li>
                  <li>ぼやけた写真を避ける</li>
                  <li>代わりにテキストで食べ物を説明する</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">HealthKitが同期しない</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>設定 &rarr; プライバシー &rarr; ヘルスケア &rarr; StatsKey を確認</li>
                  <li>すべての許可が有効になっているか確認</li>
                  <li>StatsKeyを完全に終了して再度開く</li>
                  <li>問題が続く場合はiPhoneを再起動</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">サインインできない</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>インターネット接続を確認</li>
                  <li>Appleの場合: 設定 &rarr; Appleでサインイン を確認</li>
                  <li>Googleの場合: 有効なGoogleアカウントを確認</li>
                  <li>アプリを削除して再インストール</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">アプリがクラッシュする</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>最新バージョンに更新する</li>
                  <li>iPhoneを再起動する</li>
                  <li>アプリを削除して再インストール</li>
                  <li>問題が続く場合はサポートに連絡</li>
                </ul>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">機能リクエストと不具合報告</h2>
            <p class="mb-4">フィードバックを歓迎します。<a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a> までメールしてください。</p>
            <div class="grid sm:grid-cols-2 gap-4">
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">機能リクエスト</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>機能の説明</li>
                  <li>それがあなたの健康にどのように役立つか</li>
                  <li>他のアプリの例</li>
                </ul>
              </div>
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">不具合報告</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>発生時に行っていたこと</li>
                  <li>エラーメッセージとスクリーンショット</li>
                  <li>デバイスのモデル、iOSのバージョン</li>
                  <li>問題を再現する手順</li>
                </ul>
              </div>
            </div>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">StatsKeyは医療機器ではなく、いかなる疾患の診断、治療、治癒、予防を目的としたものでもありません。すべての栄養情報は概算です。医療上の判断については、必ず医療専門家にご相談ください。詳細は<a href="/terms" class="text-accent hover:underline">利用規約</a>および<a href="/privacy" class="text-accent hover:underline">プライバシーポリシー</a>をご覧ください。</p>
          </section>
  `,
}

const pt = {
  __title: 'Suporte — StatsKey',
  'lp-title': 'Suporte',
  'lp-date': 'Última atualização: 2 de abril de 2026',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">Fale Conosco</h2>
            <div class="glass p-6">
              <p class="mb-2"><strong class="text-text-primary">E-mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
              <p class="mb-4"><strong class="text-text-primary">Tempo de resposta:</strong> Em até 24–48 horas</p>
              <p class="text-[14px] text-text-muted">Para um atendimento mais rápido, inclua o modelo do seu dispositivo (por exemplo, iPhone 15 Pro), a versão do iOS, uma descrição do problema e capturas de tela, se aplicável.</p>
            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">Perguntas Frequentes</h2>
            <div class="space-y-6">

              <div>
                <h3 class="font-medium text-text-primary mb-1">Qual é a precisão da análise de alimentos por IA?</h3>
                <p>Nossa IA fornece estimativas com base na análise visual e em tamanhos de porção típicos. Todos os valores nutricionais são aproximações e não devem ser usados para fins médicos ou clínicos. Para valores exatos, verifique a embalagem do alimento ou use a inserção manual.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Meus dados estão seguros?</h3>
                <p>Todos os dados são criptografados em trânsito e em repouso. Nunca vendemos suas informações pessoais. Consulte nossa <a href="/privacy" class="text-accent hover:underline">Política de Privacidade</a> para todos os detalhes.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Posso usar o StatsKey off-line?</h3>
                <p>Os recursos principais funcionam off-line, incluindo a visualização de refeições e exercícios registrados. A análise por IA e a sincronização na nuvem exigem conexão com a internet.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Como sincronizo com o Apple Health?</h3>
                <p>Vá em Ajustes &rarr; Integrações &rarr; Apple Health. Conceda permissões para os tipos de dados que deseja sincronizar. Você pode alterá-las a qualquer momento nos Ajustes do seu iPhone.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Como excluo minha conta?</h3>
                <p>Ajustes &rarr; Conta &rarr; Excluir Conta. Isso remove permanentemente todos os seus dados dos nossos servidores em até 30 dias.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Por que a câmera não está funcionando?</h3>
                <p>Vá em Ajustes do iPhone &rarr; StatsKey &rarr; Ativar Câmera. Talvez seja necessário reiniciar o app após conceder a permissão.</p>
              </div>

              <div>
                <h3 class="font-medium text-text-primary mb-1">Por que meus dados não estão sincronizando?</h3>
                <p>Verifique se você entrou com a Apple ou o Google e se tem conexão com a internet. Tente Ajustes &rarr; Forçar Sincronização.</p>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-6">Solução de Problemas</h2>
            <div class="grid sm:grid-cols-2 gap-4">

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Alimento Não Reconhecido</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Tire fotos com boa iluminação</li>
                  <li>Centralize o alimento no enquadramento</li>
                  <li>Evite fotos tremidas</li>
                  <li>Tente descrever o alimento com texto</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">HealthKit Não Sincroniza</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Verifique Ajustes &rarr; Privacidade &rarr; Saúde &rarr; StatsKey</li>
                  <li>Confirme que todas as permissões estão ativadas</li>
                  <li>Force o fechamento e reabra o StatsKey</li>
                  <li>Reinicie o iPhone se o problema persistir</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Não Consigo Entrar</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Verifique a conexão com a internet</li>
                  <li>Para Apple: verifique Ajustes &rarr; Login com a Apple</li>
                  <li>Para Google: confirme que a conta Google é válida</li>
                  <li>Tente excluir e reinstalar o app</li>
                </ul>
              </div>

              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">App Travando</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Atualize para a versão mais recente</li>
                  <li>Reinicie o iPhone</li>
                  <li>Exclua e reinstale o app</li>
                  <li>Entre em contato com o suporte se o problema persistir</li>
                </ul>
              </div>

            </div>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">Solicitações de Recursos e Relatórios de Bugs</h2>
            <p class="mb-4">Seu feedback é bem-vindo. Escreva para nós em <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>.</p>
            <div class="grid sm:grid-cols-2 gap-4">
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Solicitações de Recursos</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>Descrição do recurso</li>
                  <li>Como ele ajudaria na sua jornada de saúde</li>
                  <li>Exemplos de outros apps, se houver</li>
                </ul>
              </div>
              <div class="glass p-6">
                <h3 class="font-medium text-text-primary mb-3">Relatórios de Bugs</h3>
                <ul class="list-disc pl-4 space-y-1 text-[14px]">
                  <li>O que você estava fazendo quando aconteceu</li>
                  <li>Mensagens de erro e capturas de tela</li>
                  <li>Modelo do dispositivo, versão do iOS</li>
                  <li>Passos para reproduzir o problema</li>
                </ul>
              </div>
            </div>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">O StatsKey não é um dispositivo médico e não se destina a diagnosticar, tratar, curar ou prevenir qualquer doença. Todas as informações nutricionais são aproximadas. Sempre consulte um profissional de saúde para decisões médicas. Consulte nossos <a href="/terms" class="text-accent hover:underline">Termos de Serviço</a> e nossa <a href="/privacy" class="text-accent hover:underline">Política de Privacidade</a> para todos os detalhes.</p>
          </section>
  `,
}

applyI18n({ de, ja, pt })
