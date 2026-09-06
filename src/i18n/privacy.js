import { applyI18n } from './legal.js'

// German / Japanese translations of the Privacy Policy. Structure and CSS
// classes mirror the English markup in privacy.html exactly; only text changes.
// English remains the authoritative version (see the dated disclaimer line).

const de = {
  __title: 'Datenschutzerklärung — StatsKey',
  'lp-title': 'Datenschutzerklärung',
  'lp-date':
    'Gültig ab: 5. September 2026<span class="block mt-2 italic">Diese deutsche Übersetzung dient nur zur Information. Bei Abweichungen ist die englische Originalfassung maßgeblich.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Einleitung</h2>
            <p>StatsKey („StatsKey“, „wir“, „uns“ oder „unser“) betreibt eine Anwendung zur Erfassung von Ernährung, Fitness und biometrischen Daten. Diese Datenschutzerklärung beschreibt, welche Informationen wir erheben, wie wir sie verwenden und weitergeben und welche Wahlmöglichkeiten du hast. Durch die Nutzung von StatsKey stimmst du den hier beschriebenen Praktiken zu. Wenn du nicht einverstanden bist, nutze die Anwendung nicht.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Welche Informationen wir erheben</h2>
            <p class="mb-3"><strong class="text-text-primary">Kontoinformationen.</strong> Name (optional), E-Mail-Adresse, Passwort (bei der Registrierung mit E-Mail und Passwort als gesalzener Hash über Firebase Authentication gespeichert), Identifikatoren für föderierte Anmeldung (Apple-ID oder Google) sowie eine interne Nutzer-ID.</p>
            <p class="mb-3"><strong class="text-text-primary">Gesundheits- und Fitnessdaten.</strong> Mahlzeiten und Ernährungseinträge, Essensfotos und Textbeschreibungen, sportliche Aktivitäten, Dauer, Kalorienschätzungen, Gewicht und Körperwerte, eigene Ziele, aktuelle und historische Daten von kontinuierlichen Glukosemessgeräten (CGM) und Glukoseeinträge, Wellness-Protokolle und – sofern du die Berechtigung erteilst – Daten aus Apple HealthKit (unter iOS) oder Android Health Connect (unter Android) (einschließlich, aber nicht beschränkt auf Energie, Makronährstoffe, Gewicht, Herzfrequenz, Glukose und Workout-Daten).</p>
            <p class="mb-3"><strong class="text-text-primary">Standortdaten.</strong> Wenn du die Standortdienste aktivierst, erfassen wir während der aktiven Workout-Aufzeichnung GPS-Daten, um Route, Distanz, Pace und Höhenmeter zu verfolgen. Ein Standortzugriff im Hintergrund erfolgt nur, während eine Workout-Sitzung läuft, und endet, wenn die Sitzung beendet oder pausiert wird. Außerhalb der Workout-Aufzeichnung erheben wir keine Standortdaten.</p>
            <p class="mb-3"><strong class="text-text-primary">Abonnement- und Transaktionsdaten.</strong> Kaufhistorie, Abostatus, Abrechnungskanal (App Store, Google Play oder Stripe), Apple-Beleg-Tokens (für App-Store-Abos), Google-Play-Kauftokens (für Google-Play-Abos), Stripe-Kunden- und Abonnement-IDs (für Web-Abos) sowie begrenzte Geräte- und Anwendungskennungen zur Belegprüfung, Abrechnungsabstimmung und Betrugsprävention. Wir speichern keine vollständigen Zahlungskartendaten; Kartendaten werden von Apple, Google oder Stripe verarbeitet und gespeichert.</p>
            <p class="mb-3"><strong class="text-text-primary">Geräte- und Nutzungsdaten.</strong> Gerätemodell, Betriebssystemversion, Anwendungsversion, Nutzungsmuster von Funktionen und Performance-Ereignisdaten.</p>
            <p class="mb-3"><strong class="text-text-primary">Diagnosedaten.</strong> Absturzprotokolle, Fehlerberichte und Performance-Diagnosen.</p>
            <p><strong class="text-text-primary">Support-Kommunikation.</strong> Nachrichten und Anhänge, die du an unsere Support-Kanäle sendest.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Wie wir deine Informationen verwenden</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Bereitstellung des Dienstes:</strong> Kontoerstellung, Authentifizierung, Datensynchronisierung und Kernfunktionen der Anwendung.</li>
              <li><strong class="text-text-primary">KI-gestützte Analyse:</strong> Verarbeitung von Essensfotos, Textbeschreibungen, Chatnachrichten und relevanten historischen Gesundheitsdaten, einschließlich Glukoseeinträgen, über KI-Dienste von Drittanbietern, um Nährwertschätzungen, Zusammenfassungen und dialogbasierte Antworten zu erzeugen. Diese Ergebnisse sind nur Näherungswerte und sollten nicht für medizinische, diätetische oder klinische Entscheidungen herangezogen werden.</li>
              <li><strong class="text-text-primary">Personalisierung:</strong> Anpassung von Empfehlungen und Zielen anhand deines Profils und deiner historischen Daten.</li>
              <li><strong class="text-text-primary">Gesundheitsintegrationen:</strong> Lesen und/oder Schreiben von Daten aus Apple HealthKit (unter iOS) oder Android Health Connect (unter Android) ausschließlich, um von dir ausdrücklich aktivierte Gesundheits- und Fitnessfunktionen bereitzustellen, einschließlich der Nutzung von Apple Health oder Health Connect als optionale Quelle für Glukose- und andere historische Daten.</li>
              <li><strong class="text-text-primary">Analyse und Qualität:</strong> Verständnis der Funktionsnutzung, Fehlerdiagnose und Verbesserung der Anwendungsleistung.</li>
              <li><strong class="text-text-primary">Sicherheit und Betrugsprävention:</strong> Prüfung von Käufen, Verhinderung von Missbrauch und Schutz von Nutzerkonten.</li>
              <li><strong class="text-text-primary">Kommunikation:</strong> Versand von servicebezogenen Hinweisen (z. B. Änderungen des Abostatus, wesentliche Änderungen der Bedingungen). Wir können dir auch in regelmäßigen Abständen Produktneuigkeiten, Tipps und Werbe-E-Mails zu StatsKey senden und holen, wo gesetzlich erforderlich, deine Einwilligung dafür ein. Du kannst diese jederzeit über den Abmeldelink in jeder solchen E-Mail beenden; servicebezogene Hinweise können bei Bedarf weiterhin gesendet werden. HealthKit- und Glukosedaten werden niemals für Marketing verwendet.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Offenlegung zu Apple HealthKit &amp; Android Health Connect</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Über Apple HealthKit (iOS) oder Android Health Connect (Android) abgerufene Daten werden ausschließlich verwendet, um Gesundheits- und Fitnessfunktionen innerhalb der Anwendung bereitzustellen oder zu verbessern, einschließlich des Imports historischer Glukosedaten, wenn du die entsprechende Apple-Health- oder Health-Connect-Berechtigung erteilst.</li>
              <li>Diese Gesundheitsdaten werden niemals für Marketing, Werbung oder Datenhandel verwendet und niemals an Dritte verkauft.</li>
              <li>Diese Gesundheitsdaten werden nur insoweit an Dritte weitergegeben, wie es zu ihrer Verarbeitung in deinem Auftrag zur Bereitstellung des Dienstes erforderlich ist, und niemals zur eigenständigen Nutzung durch diese Parteien.</li>
              <li>Glukose- und andere Gesundheitsdaten, die du synchronisierst, können über Firebase / Google Cloud Platform in deinem StatsKey-Konto gesichert werden, damit sie geräteübergreifend und für aktivierte StatsKey-Funktionen, einschließlich KI-Dialogfunktionen, verfügbar sind. Importierte klinische Apple-/FHIR-Daten werden wie unten beschrieben behandelt.</li>
              <li>Du kannst diese Berechtigungen jederzeit über die Apple-Health-Einstellungen (iOS) oder die Android-Health-Connect-Einstellungen (Android) widerrufen. Ein Widerruf stoppt neue Datenflüsse, löscht jedoch zuvor gespeicherte Daten nicht automatisch – siehe Abschnitt 10 („Deine Rechte“).</li>
            </ul>
            <p class="mt-3" data-clinical-disclosure="1"><strong class="text-text-primary">Optionale klinische Daten aus Apple Health.</strong> Dieser Zugriff ist freiwillig und für die Lebensmittelsuche oder manuelle Aufzeichnungen nicht erforderlich. Wenn du Apples gesonderte Berechtigung für klinische Daten erteilst und Private Sync für dein StatsKey-Konto auf dieser Installation aktivierst, kopiert StatsKey die freigegebenen Datensätze in dein Konto. Dazu können Allergien, Erkrankungen, Impfungen, Laborergebnisse, Medikamente, Eingriffe, Vitalzeichen, Versicherungsangaben und klinische Notizen gehören. Die Kopie enthält den vollständigen FHIR-Inhalt des Anbieters, der dich identifizieren kann, sowie Datums- und Quellenangaben.</p>
            <p class="mt-3" data-clinical-disclosure="2">Diese importierten klinischen Daten dienen der Aufbewahrung deiner freigegebenen Gesundheitsgeschichte und werden in von dir gestartete vollständige Datenexporte aufgenommen. Die Integration bietet keine klinische Auswertung oder eigene Ansicht für klinische Datensätze, fügt diese Daten nicht automatisch zum Intelligence-Kontext hinzu und teilt sie nicht über Friends oder das Ärzteportal. Du kannst einen Export selbst weitergeben. Informationen, die du unabhängig davon in eine KI-Anfrage eingibst, einfügst oder als Anhang hinzufügst, werden gemäß Abschnitt 5 als Inhalt dieser Anfrage verarbeitet.</p>
            <p class="mt-3" data-clinical-disclosure="3">Die Kontokopie wird in Google/Firebase Cloud Firestore in den Vereinigten Staaten gespeichert. Der reguläre App-Zugriff erfordert die Anmeldung als Kontoinhaber. Google/Firebase stellt die Speicherinfrastruktur bereit; StatsKey-Dienstidentitäten oder Administratoren mit privilegierten Cloud-Berechtigungen können auf die Daten zugreifen. Die Daten sind gegenüber dem Dienstbetreiber nicht Ende-zu-Ende-verschlüsselt. Die App kann Daten auch im lokalen Firestore-Cache speichern und lokale Exportdateien erstellen. Die Originaldaten verbleiben in Apple Health.</p>
            <p class="mt-3" data-clinical-disclosure="4">Aktiviere die Funktion unter Einstellungen → Gesundheit &amp; Körper → Apple Health, indem du den Zugriff erlaubst und gesondert Enable and Sync für Private Sync auswählst. Turn Off Private Sync, Stop Using Apple Health oder der Widerruf der Apple-Health-Berechtigung stoppt neue Uploads von dieser Installation; vorhandene Kopien bleiben erhalten. Andere Installationen haben eigene Synchronisierungseinstellungen. Fordere die Löschung an oder lösche dein Konto über die in den Abschnitten 9, 10 und 12 genannten Einstellungen und Kontaktwege. Exportierte und weitergegebene Dateien unterliegen deiner Kontrolle oder der des Empfängers.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. KI-Verarbeitung</h2>
            <p class="mb-3">Wenn du eine KI-gestützte Funktion in der App nutzt (Intelligence-Chat, Essensfoto-Analyse, Nährwertetiketten-Scan, KI-generierte Trainingspläne, KI-generierte Ernährungs-Einblicke), übermitteln wir die für die aktive Funktion erforderlichen Inhalte an einen oder mehrere KI-Verarbeiter von Drittanbietern, damit diese eine Antwort berechnen können. Die aktuellen KI-Verarbeiter sind:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> – Gemini, zugänglich über Firebase AI Logic und die Google Generative AI API. <a href="https://policies.google.com/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von Google</a>.</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> – Claude, zugänglich über die API von Anthropic. <a href="https://www.anthropic.com/legal/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von Anthropic</a>.</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> – ChatGPT-Modelle, zugänglich über die OpenAI-API (einschließlich der Responses-API für die bildbasierte Essensanalyse als Fallback). <a href="https://openai.com/policies/row-privacy-policy/" class="text-accent hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von OpenAI</a>.</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> – Grok, zugänglich über die xAI-API. <a href="https://x.ai/legal/privacy-policy" class="text-accent hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von xAI</a>.</li>
            </ul>
            <p class="mb-3">Zu den Kategorien personenbezogener Inhalte, die wir an die oben genannten Anbieter übermitteln können, gehören: Nachrichten und Eingaben, die du in den KI-Chat tippst; Fotos, die du für die Essens- bzw. Nährwertetiketten-Analyse aufnimmst oder auswählst; Zusammenfassungen deiner Ernährungs-, Gewichts-, Flüssigkeits-, Nahrungsergänzungs- und Glukose-Protokolle; historische Glukosedaten und zugehörige Trends, sofern für deine Anfrage relevant; Zusammenfassungen deiner Workouts, Pace, Herzfrequenz und Trainingspläne; sowie grundlegende Profilfelder aus dem Onboarding (Name, biologisches Geschlecht, Gewicht, Größe, Ziele).</p>
            <p class="mb-3">Bevor wir Inhalte zum ersten Mal an diese Verarbeiter übermitteln, zeigt die App einen In-App-Hinweis, der die Verarbeiter und die oben genannten Inhaltskategorien benennt und dich um deine Erlaubnis bittet. Du kannst diese Erlaubnis jederzeit unter <em>Einstellungen &rarr; KI &amp; Datenschutz &rarr; KI-Funktionen</em> einsehen oder widerrufen. Ein Widerruf deaktiviert jede KI-gestützte Funktion der App, während der Rest der App voll funktionsfähig bleibt.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Wir senden keine Kontokennungen, Kontaktdaten oder andere persönliche Identifikatoren mit den Inhalten, die die KI-Verarbeiter erhalten.</li>
              <li>KI-generierte Ergebnisse sind Schätzungen und Näherungswerte. Sie können ungenau, unvollständig oder falsch sein. Du solltest dich nicht für medizinische, klinische oder kritische diätetische Entscheidungen darauf verlassen.</li>
              <li>Wir stimmen nicht zu, dass deine Daten zum Trainieren von KI-Modellen Dritter verwendet werden. Anbieter können Daten gemäß ihren jeweiligen Richtlinien vorübergehend zur Missbrauchsprävention und Diagnose aufbewahren.</li>
              <li>Die Gruppe der KI-Anbieter, die konkret verwendeten Modelle und das Routing dazwischen können sich ändern. Wesentliche Änderungen dieser Liste lösen einen neuen In-App-Hinweis aus, bevor der neue Anbieter Inhalte von dir erhält.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Drittanbieter-Dienstleister</h2>
            <p class="mb-3">Wir nutzen die folgenden Kategorien von Dienstleistern, um die Anwendung zu betreiben:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Firebase / Google Cloud Platform:</strong> Authentifizierung, sichere Datenspeicherung einschließlich synchronisierter historischer Glukosedaten, Analyse und Absturzberichte.</li>
              <li><strong class="text-text-primary">Apple App Store:</strong> Abrechnung von Abonnements für Nutzer, die über die iOS-App abonnieren.</li>
              <li><strong class="text-text-primary">Google Play:</strong> Abrechnung von Abonnements für Nutzer, die über die Android-App abonnieren.</li>
              <li><strong class="text-text-primary">Stripe:</strong> Abrechnung von Abonnements und Zahlungsabwicklung für Nutzer, die über die Website abonnieren. Stripe erhält Kartendaten, Rechnungsadresse und eine pseudonyme Nutzerkennung; wir erhalten nur Kunden- und Abonnement-IDs sowie einen groben Status.</li>
              <li><strong class="text-text-primary">KI-Anbieter (Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok):</strong> KI-gestützte Essensanalyse, Nährwertschätzung, Erstellung von Trainingsplänen und Dialogfunktionen. Siehe Abschnitt 5 für die Links je Anbieter und den In-App-Berechtigungsablauf.</li>
              <li><strong class="text-text-primary">Apple HealthKit &amp; Android Health Connect:</strong> Optionale Synchronisierung von Gesundheitsdaten mit deiner ausdrücklichen Erlaubnis.</li>
              <li><strong class="text-text-primary">CGM-Anbieter (Dexcom, Abbott, Nightscout):</strong> Optionale Integration von Daten kontinuierlicher Glukosemessgeräte mit deiner ausdrücklichen Erlaubnis.</li>
              <li><strong class="text-text-primary">Nährwertdatenquellen:</strong> Öffentliche oder lizenzierte Datenbanken zur Anreicherung von Nährwertangaben. Wir übermitteln nur Lebensmittelkontext, keine persönlichen Identifikatoren.</li>
            </ul>
            <p class="mt-3">Alle Verarbeiter sind verpflichtet, deine Informationen zu schützen und sie nur gemäß unseren Anweisungen und dem geltenden Recht zu verwenden.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Weitergabe von Daten</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Kein Verkauf:</strong> Wir verkaufen deine personenbezogenen Daten nicht. Wir geben keine Daten an Dritte für kontextübergreifende verhaltensbasierte Werbung weiter.</li>
              <li><strong class="text-text-primary">Dienstleister:</strong> Weitergabe nur, soweit zur Bereitstellung der Anwendung erforderlich, unter Vertraulichkeits- und Sicherheitsverpflichtungen.</li>
              <li><strong class="text-text-primary">Gesetzliche Pflichten:</strong> Wir können Informationen offenlegen, wenn dies gesetzlich, durch Vorladung, Gerichtsbeschluss oder behördliche Anordnung verlangt wird oder wenn wir in gutem Glauben davon ausgehen, dass eine Offenlegung zum Schutz von Rechten, Sicherheit oder Eigentum erforderlich ist.</li>
              <li><strong class="text-text-primary">Aggregierte Daten:</strong> Wir können nicht identifizierbare, aggregierte Statistiken weitergeben, die sich nicht vernünftigerweise mit einer Einzelperson verknüpfen lassen.</li>
              <li><strong class="text-text-primary">Geschäftsübertragungen:</strong> Im Falle einer Fusion, Übernahme oder eines Verkaufs von Vermögenswerten können deine Informationen im Rahmen dieser Transaktion übertragen werden. Wir werden dich über eine solche Änderung informieren.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Datensicherheit</h2>
            <p>Wir setzen Verschlüsselung bei der Übertragung (TLS) und im Ruhezustand, Zugriffskontrollen, das Prinzip der geringsten Rechte und branchenübliche Sicherheitspraktiken ein. Keine Methode der elektronischen Übertragung oder Speicherung ist jedoch vollständig sicher. Wir können und werden keine absolute Sicherheit deiner Daten garantieren. Du nutzt die Anwendung und übermittelst Informationen auf eigenes Risiko.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Speicherdauer</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Kontodaten:</strong> Werden aufbewahrt, solange dein Konto aktiv ist. Die Anforderung einer Kontolöschung startet einen Wiederherstellungszeitraum von 30 Tagen. Danach entfernt die tägliche Bereinigung die aktiven Kontodaten, außer wenn eine Aufbewahrung gesetzlich vorgeschrieben oder für berechtigte geschäftliche Zwecke erforderlich ist (z. B. Betrugsprävention oder Finanzunterlagen).</li>
              <li data-recovery-retention="true"><strong class="text-text-primary">Wiederherstellungskopien und lokale Dateien:</strong> Firestore-Wiederherstellungsversionen und Backups laufen unabhängig von den aktiven Kontodaten ab: zeitpunktbezogene Wiederherstellungsversionen und tägliche Backups nach sieben Tagen, wöchentliche Backups nach 98 Tagen. Das Ausschalten der Synchronisierung oder die Anforderung einer Kontolöschung entfernt Wiederherstellungskopien, den lokalen App-Cache oder von dir oder Empfängern exportierte Dateien nicht sofort.</li>
              <li><strong class="text-text-primary">Kaufunterlagen:</strong> Werden so lange aufbewahrt, wie es für Finanz-, Prüf- und Betrugspräventionspflichten erforderlich ist.</li>
              <li><strong class="text-text-primary">Analyse und Diagnose:</strong> In der Regel bis zu 24 Monate, sofern keine längere Aufbewahrung aus Sicherheits- oder Rechtsgründen erforderlich ist.</li>
              <li>Du kannst einzelne Einträge (Mahlzeiten, Workouts, Fotos) jederzeit in der Anwendung löschen.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Deine Rechte und Wahlmöglichkeiten</h2>
            <p class="mb-3">Je nach deinem Rechtsraum hast du möglicherweise das Recht:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>auf Zugang zu den personenbezogenen Daten, die wir über dich speichern.</li>
              <li>unrichtige oder unvollständige Daten zu berichtigen.</li>
              <li>dein Konto und die zugehörigen personenbezogenen Daten zu löschen.</li>
              <li>deine Daten in einem gängigen, maschinenlesbaren Format zu exportieren.</li>
              <li>deine Einwilligung zu widerrufen (z. B. HealthKit-Berechtigungen, Standortdienste).</li>
              <li>nicht wesentliche Analysen abzulehnen, sofern verfügbar.</li>
            </ul>
            <p class="mt-3">Um diese Rechte auszuüben, nutze die In-App-Einstellungen oder kontaktiere uns unter der unten angegebenen Adresse. Wir müssen deine Identität möglicherweise überprüfen, bevor wir eine Anfrage bearbeiten, und können Anfragen ablehnen, soweit dies nach geltendem Recht zulässig ist.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Einwohner Kaliforniens (CCPA/CPRA)</h2>
            <p class="mb-3">Wenn du in Kalifornien ansässig bist, hast du zusätzliche Rechte nach dem California Consumer Privacy Act und dem California Privacy Rights Act, darunter:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>das Recht zu erfahren, welche personenbezogenen Informationen erhoben, verwendet, weitergegeben oder verkauft werden.</li>
              <li>das Recht, von uns gespeicherte personenbezogene Informationen zu löschen.</li>
              <li>das Recht, dem Verkauf oder der Weitergabe personenbezogener Informationen zu widersprechen. Wir verkaufen keine personenbezogenen Informationen.</li>
              <li>das Recht auf Nichtdiskriminierung bei der Ausübung deiner Datenschutzrechte.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Gesundheitsdaten von Verbrauchern (Washington, Nevada, Connecticut und ähnliche Gesetze)</h2>
            <p class="mb-3">Wenn du in einem Bundesstaat mit einem Gesetz zu Verbraucher-Gesundheitsdaten ansässig bist – darunter der Washington My Health My Data Act (MHMDA), Nevada SB 370 und der Connecticut Data Privacy Act (in der jeweils geltenden Fassung) –, beschreibt dieser Abschnitt die zusätzlichen Informationskategorien, die wir als „Verbraucher-Gesundheitsdaten“ behandeln, sowie deine Rechte in Bezug auf diese Informationen. Glukosewerte, Daten kontinuierlicher Glukosemessgeräte (CGM) und zugehörige Stoffwechseldaten werden im Rahmen dieser Datenschutzerklärung unabhängig von deinem Wohnsitzstaat als Verbraucher-Gesundheitsdaten behandelt.</p>
            <p class="mb-3"><strong class="text-text-primary">Kategorien der erhobenen Verbraucher-Gesundheitsdaten.</strong> Glukosewerte und CGM-Trenddaten (aktuell und historisch, ob aus Apple Health, Android Health Connect, Dexcom Share, Abbott LibreLinkUp, Nightscout importiert oder manuell eingegeben); Protokolle zu Lebensmitteln, Getränken, Nahrungsergänzung und Flüssigkeitszufuhr, die Gesundheitszustände oder Behandlungsmuster offenbaren können; Gewicht, Körperzusammensetzung und biometrische Messungen; Protokolle zu Symptomen, Energie, Stimmung, Schlaf und Wellness; Workout-, Herzfrequenz- und andere Aktivitätsdaten; sowie alle weiteren Informationen, die du bereitstellst und die deinen vergangenen, gegenwärtigen oder zukünftigen körperlichen oder psychischen Gesundheitszustand, Erkrankungen oder Behandlungen identifizieren.</p>
            <p class="mb-3"><strong class="text-text-primary">Wie wir sie verwenden.</strong> Verbraucher-Gesundheitsdaten werden nur verarbeitet, um (i) die von dir ausdrücklich aktivierten Anwendungsfunktionen bereitzustellen, (ii) deine Daten geräteübergreifend zu synchronisieren, (iii) die von dir angeforderten persönlichen Ernährungs-, Wellness- und KI-Zusammenfassungen zu erstellen und (iv) die Kontosicherheit aufrechtzuerhalten und Missbrauch zu verhindern. Wir verkaufen keine Verbraucher-Gesundheitsdaten, geben sie nicht für kontextübergreifende verhaltensbasierte Werbung weiter und verwenden sie nicht für gezielte Werbung in unserem oder fremdem Namen.</p>
            <p class="mb-3"><strong class="text-text-primary">Weitergabe.</strong> Verbraucher-Gesundheitsdaten werden nur an die in den Abschnitten 5 und 6 beschriebenen Verarbeiter weitergegeben (Firebase / Google Cloud Platform für sichere Speicherung, KI-Anbieter, wenn du KI-Funktionen aktiv nutzt, und Stripe / Apple für die Abrechnung – keiner davon erhält rohe Glukosedaten zum Zweck des Trainings von Modellen über dich) und nur, soweit dies zur Bereitstellung der Anwendung oder zur Einhaltung geltenden Rechts erforderlich ist.</p>
            <p class="mb-3"><strong class="text-text-primary">Deine Rechte.</strong> Du hast das Recht, (a) zu bestätigen, ob wir deine Verbraucher-Gesundheitsdaten erheben, weitergeben oder verkaufen, und auf diese Daten zuzugreifen, (b) deine Einwilligung in die Erhebung und Weitergabe von Verbraucher-Gesundheitsdaten zu widerrufen, (c) deine Verbraucher-Gesundheitsdaten löschen zu lassen, auch bei unseren Verarbeitern, die die Daten in unserem Auftrag halten, und (d) gegen eine Entscheidung zu deiner Anfrage Einspruch einzulegen. Wir verkaufen keine Verbraucher-Gesundheitsdaten, sodass kein separates Widerspruchsrecht gegen einen Verkauf besteht. Um diese Rechte auszuüben, kontaktiere uns unter <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>; wir antworten innerhalb der nach dem jeweiligen Landesrecht erforderlichen Fristen. Wenn wir eine Anfrage ablehnen, kannst du Einspruch einlegen, indem du auf diese Entscheidung mit dem Wort „Appeal“ in der Betreffzeile antwortest, und du kannst zudem eine Beschwerde beim Generalstaatsanwalt deines Wohnsitzstaates einreichen.</p>
            <p class="mb-3"><strong class="text-text-primary">Geofencing.</strong> StatsKey verwendet keine Geofences um Gesundheitseinrichtungen, Einrichtungen für psychische Gesundheit, Einrichtungen für reproduktive Gesundheit oder ähnliche Orte.</p>
            <p><strong class="text-text-primary">Autorisierung zur Weitergabe.</strong> Wir geben Verbraucher-Gesundheitsdaten ohne deine vorherige schriftliche Autorisierung weder weiter noch verkaufen wir sie. Wenn du eine CGM- oder HealthKit-Integration verbindest, autorisierst du StatsKey, Verbraucher-Gesundheitsdaten aus dieser Quelle abzurufen und zu verarbeiten, um die von dir aktivierten Anwendungsfunktionen bereitzustellen, und diese Daten in deinem StatsKey-Konto zu speichern, bis du sie löschst. Das Ausschalten einer Integration in der App oder der Widerruf ihrer Geräteberechtigungen stoppt neue Abrufe von dieser Installation, löscht aber nicht von selbst bereits gespeicherte Kontodaten. Um die Einwilligung in unsere fortlaufende Erhebung oder Weitergabe zu widerrufen oder die Löschung von Verbraucher-Gesundheitsdaten zu beantragen, kontaktiere uns wie oben beschrieben. Die Kontolöschung ist auch in den Einstellungen verfügbar. Wir bearbeiten diese Anfragen gemäß den Rechten und Aufbewahrungsbestimmungen der Abschnitte 9, 10 und dieses Abschnitts.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Einwohner des EWR / Vereinigten Königreichs (DSGVO)</h2>
            <p class="mb-3">Unsere Rechtsgrundlagen für die Verarbeitung personenbezogener Daten umfassen:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Vertrag:</strong> Zur Bereitstellung der Anwendung und zur Erfüllung unserer Vereinbarung mit dir.</li>
              <li><strong class="text-text-primary">Einwilligung:</strong> Für HealthKit- oder Health-Connect-Zugriff, Standortdienste und bestimmte Analysen.</li>
              <li><strong class="text-text-primary">Berechtigte Interessen:</strong> Sicherheit der Anwendung, Betrugsprävention, Qualitätsverbesserung – abgewogen gegen deine Rechte.</li>
              <li><strong class="text-text-primary">Gesetzliche Verpflichtung:</strong> Einhaltung geltender Gesetze.</li>
            </ul>
            <p class="mt-3">Wir können Daten in den Vereinigten Staaten und anderen Ländern verarbeiten und speichern. Wo erforderlich, nutzen wir geeignete Garantien (z. B. Standardvertragsklauseln) für internationale Übermittlungen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Privatsphäre von Kindern</h2>
            <p>StatsKey richtet sich nicht an Kinder unter 13 Jahren. Wir erheben nicht wissentlich personenbezogene Daten von Kindern unter 13 Jahren. Wenn du glaubst, dass uns ein Kind personenbezogene Daten übermittelt hat, kontaktiere uns bitte, und wir werden sie umgehend löschen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Kamera &amp; Fotos</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Der Kamerazugriff wird ausschließlich verwendet, um von dir ausgewählte Essensfotos aufzunehmen.</li>
              <li>Fotos werden verarbeitet, um Lebensmittel zu erkennen und Nährwertschätzungen zu erstellen.</li>
              <li>Originalfotos verbleiben auf deinem Gerät, sofern du sie nicht mit der Anwendung synchronisierst.</li>
              <li>Wir greifen ohne deine ausdrückliche Erlaubnis nicht auf deine Fotomediathek zu.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Änderungen dieser Erklärung</h2>
            <p>Wir können diese Datenschutzerklärung von Zeit zu Zeit aktualisieren. Bei wesentlichen Änderungen informieren wir dich über die Anwendung oder auf andere angemessene Weise. Deine fortgesetzte Nutzung von StatsKey nach dem Datum des Inkrafttretens von Änderungen gilt als Annahme der aktualisierten Erklärung.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Kontakt</h2>
            <p>Wenn du Fragen zu dieser Datenschutzerklärung hast oder deine Rechte ausüben möchtest:</p>
            <p class="mt-2"><strong class="text-text-primary">E-Mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>
  `,
}

const ja = {
  __title: 'プライバシーポリシー — StatsKey',
  'lp-title': 'プライバシーポリシー',
  'lp-date':
    '発効日：2026年9月5日<span class="block mt-2 italic">この日本語訳は参考用です。内容に相違がある場合は、英語の原文が優先されます。</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. はじめに</h2>
            <p>StatsKey（以下「StatsKey」「当社」）は、栄養、フィットネス、生体データを記録するアプリケーションを運営しています。本プライバシーポリシーは、当社が収集する情報、その使用および共有の方法、ならびにお客様の選択肢について説明します。StatsKeyを利用することにより、お客様はここに記載された取り扱いに同意するものとします。同意されない場合は、本アプリケーションを利用しないでください。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. 当社が収集する情報</h2>
            <p class="mb-3"><strong class="text-text-primary">アカウント情報。</strong> 氏名（任意）、メールアドレス、パスワード（メールとパスワードで登録した場合、Firebase Authenticationによりソルト付きハッシュとして保存されます）、フェデレーションサインインの識別子（Apple IDまたはGoogle）、および内部ユーザーID。</p>
            <p class="mb-3"><strong class="text-text-primary">健康・フィットネスデータ。</strong> 食事および栄養の記録、食べ物の写真とテキストによる説明、運動アクティビティ、所要時間、カロリーの推定値、体重および身体測定値、カスタム目標、持続血糖測定器（CGM）の現在および過去のデータと血糖の記録、ウェルネスの記録、ならびに——お客様が許可した場合——Apple HealthKit（iOS）またはAndroid Health Connect（Android）のデータ（エネルギー、マクロ栄養素、体重、心拍数、グルコース、ワークアウトデータを含みますが、これらに限られません）。</p>
            <p class="mb-3"><strong class="text-text-primary">位置情報データ。</strong> 位置情報サービスを有効にした場合、当社はワークアウトの記録中にGPSデータを収集し、ルート、距離、ペース、標高を記録します。バックグラウンドでの位置情報アクセスは、ワークアウトのセッション進行中にのみ行われ、セッションが終了または一時停止されると停止します。ワークアウトの記録以外で位置情報を収集することはありません。</p>
            <p class="mb-3"><strong class="text-text-primary">サブスクリプション・取引データ。</strong> 購入履歴、サブスクリプションの状態、課金チャネル（App Store、Google Play、またはStripe）、Appleのレシートトークン（App Storeのサブスクリプション用）、Google Playの購入トークン（Google Playのサブスクリプション用）、Stripeの顧客およびサブスクリプションID（ウェブのサブスクリプション用）、ならびにレシートの検証、課金の照合、不正防止に使用される限定的なデバイスおよびアプリの識別子。当社は完全な支払いカード情報を保存しません。カード情報はApple、Google、またはStripeによって処理・保存されます。</p>
            <p class="mb-3"><strong class="text-text-primary">デバイス・利用データ。</strong> デバイスのモデル、OSのバージョン、アプリのバージョン、機能の利用パターン、パフォーマンスイベントのデータ。</p>
            <p class="mb-3"><strong class="text-text-primary">診断データ。</strong> クラッシュログ、エラーレポート、パフォーマンス診断。</p>
            <p><strong class="text-text-primary">サポートに関する連絡。</strong> お客様が当社のサポート窓口に送信したメッセージおよび添付ファイル。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. 情報の利用方法</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">サービスの提供:</strong> アカウントの作成、認証、データの同期、およびアプリの中核機能。</li>
              <li><strong class="text-text-primary">AIによる分析:</strong> 食べ物の写真、テキストによる説明、チャットメッセージ、および血糖記録を含む関連する過去の健康データを、第三者のAIサービスを通じて処理し、栄養の推定値、要約、対話形式の回答を生成します。これらの出力はあくまで概算であり、医療、食事、臨床上の判断に用いるべきではありません。</li>
              <li><strong class="text-text-primary">パーソナライズ:</strong> お客様のプロフィールおよび過去のデータに基づく推奨や目標の調整。</li>
              <li><strong class="text-text-primary">健康連携:</strong> お客様が明示的に有効にした健康・フィットネス機能を提供するためだけに、Apple HealthKit（iOS）またはAndroid Health Connect（Android）のデータを読み取りおよび／または書き込みます。これには、グルコースやその他の過去の記録の任意のソースとしてApple HealthまたはHealth Connectを使用することを含みます。</li>
              <li><strong class="text-text-primary">分析と品質:</strong> 機能の利用状況の把握、エラーの診断、アプリのパフォーマンス向上。</li>
              <li><strong class="text-text-primary">セキュリティと不正防止:</strong> 購入の検証、不正利用の防止、ユーザーアカウントの保護。</li>
              <li><strong class="text-text-primary">連絡:</strong> サービスに関する通知（サブスクリプション状態の変更、規約の重要な変更など）の送信。法律で必要な場合に同意を得たうえで、StatsKeyに関する製品情報、ヒント、プロモーションメールを定期的に送信することがあります。これらは各メールに含まれる配信停止リンクからいつでも停止できます。サービスに関する通知は必要に応じて引き続き送信される場合があります。HealthKitおよびグルコースのデータがマーケティングに使用されることはありません。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Apple HealthKitおよびAndroid Health Connectに関する開示</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Apple HealthKit（iOS）またはAndroid Health Connect（Android）を通じてアクセスされるデータは、お客様が該当するApple HealthまたはHealth Connectの許可を与えた場合の過去の血糖記録のインポートを含め、アプリ内の健康・フィットネス機能を提供または改善するためにのみ使用されます。</li>
              <li>これらの健康データが、マーケティング、広告、データブローカーのために使用されることは決してなく、いかなる相手にも販売されることはありません。</li>
              <li>これらの健康データは、サービスを提供するためにお客様に代わって処理するために必要な場合を除き第三者と共有されることはなく、それらの当事者が独自に利用することは決してありません。</li>
              <li>お客様が同期を選択したグルコースおよびその他の健康記録は、Firebase / Google Cloud Platformを使用してStatsKeyアカウントにバックアップされ、複数のデバイスや、AIの会話機能を含む有効なStatsKey機能で利用できるようになる場合があります。取り込んだAppleの診療記録・FHIRデータは、以下の説明に従って取り扱います。</li>
              <li>これらの許可は、Apple Healthの設定（iOS）またはAndroid Health Connectの設定（Android）からいつでも取り消すことができます。取り消しは新たなデータの流れを停止しますが、以前に保存されたデータが自動的に削除されるわけではありません——第10条（「お客様の権利」）をご覧ください。</li>
            </ul>
            <p class="mt-3" data-clinical-disclosure="1"><strong class="text-text-primary">任意のApple診療記録連携。</strong> 診療記録へのアクセスは任意であり、食品検索や手動での記録には必要ありません。Appleの診療記録に関する個別の許可を付与し、このアプリのインストールでStatsKeyアカウントのPrivate Syncを有効にした場合、許可された記録がアカウントにコピーされます。対象には、アレルギー、疾患、予防接種、検査結果、薬剤、処置、バイタルサイン、保険情報、診療メモが含まれる場合があります。コピーには、個人を識別し得る医療提供者の完全なFHIRデータ、日付、出典情報が含まれます。</p>
            <p class="mt-3" data-clinical-disclosure="2">取り込んだ診療記録は、許可された健康履歴の保管と、お客様が開始する全データのエクスポートに使用されます。この連携は、診療上の解釈や診療記録専用ビューアを提供せず、これらの記録をIntelligenceのコンテキストへ自動追加したり、Friendsや医療従事者向けポータルで共有したりしません。エクスポートしたファイルはお客様自身で共有できます。別途AIへの依頼に入力、貼り付け、添付した情報は、第5条に従い、その依頼の内容として処理されます。</p>
            <p class="mt-3" data-clinical-disclosure="3">アカウントのコピーは、米国のGoogle/Firebase Cloud Firestoreに保存されます。通常のアプリアクセスには、アカウント所有者としてのログインが必要です。Google/Firebaseがストレージ基盤を提供し、特権的なクラウド権限を持つStatsKeyのサービスIDや管理者も記録へアクセスできます。サービス運営者に対するエンドツーエンド暗号化ではありません。アプリは端末上のFirestoreキャッシュに記録を保持し、ローカルのエクスポートファイルを作成することもあります。元の記録はApple Healthに残ります。</p>
            <p class="mt-3" data-clinical-disclosure="4">設定 → 健康と身体 → Apple Healthでアクセスを許可し、別途Private SyncのEnable and Syncを選択すると有効になります。Turn Off Private Sync、Stop Using Apple Health、またはApple Healthの権限の取り消しにより、このインストールからの新規アップロードは停止しますが、コピー済みの履歴は残ります。他のインストールには個別の同期設定があります。削除の依頼やアカウント削除には、第9条、第10条、第12条の設定や連絡手順をご利用ください。エクスポートして共有したファイルは、お客様または受取人の管理下にあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. AIによる処理</h2>
            <p class="mb-3">アプリ内でAI機能（Intelligenceチャット、食事写真分析、栄養ラベルのスキャン、AIによるトレーニングプラン生成、AIによる栄養インサイト生成）を利用すると、当社はその機能に必要なコンテンツを、応答を計算するために1つ以上の第三者AIプロセッサに送信します。現在のAIプロセッサは次のとおりです:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> — Gemini（Firebase AI LogicおよびGoogle Generative AI API経由でアクセス）。<a href="https://policies.google.com/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Googleプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> — Claude（AnthropicのAPI経由でアクセス）。<a href="https://www.anthropic.com/legal/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Anthropicプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> — ChatGPTモデル（OpenAI API経由でアクセス。画像ベースの食事分析のフォールバック用のResponses APIを含む）。<a href="https://openai.com/policies/row-privacy-policy/" class="text-accent hover:underline" target="_blank" rel="noopener">OpenAIプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> — Grok（xAI API経由でアクセス）。<a href="https://x.ai/legal/privacy-policy" class="text-accent hover:underline" target="_blank" rel="noopener">xAIプライバシーポリシー</a>。</li>
            </ul>
            <p class="mb-3">上記のプロバイダーに送信する可能性のある個人的なコンテンツのカテゴリーには、次のものが含まれます: AIチャットに入力したメッセージやプロンプト、食事／栄養ラベルの分析のために撮影または選択した写真、栄養・体重・水分・サプリメント・グルコースの記録の要約、リクエストに関連する場合の過去の血糖記録および関連する傾向、ワークアウト・ペース・心拍数・トレーニングプランの要約、ならびにオンボーディングで入力した基本的なプロフィール項目（氏名、生物学的性別、体重、身長、目標）。</p>
            <p class="mb-3">これらのプロセッサに初めてコンテンツを送信する前に、アプリはプロセッサ名と上記のコンテンツのカテゴリーを示すアプリ内の開示を表示し、許可を求めます。この許可は <em>設定 &rarr; AIとプライバシー &rarr; AI機能</em> からいつでも確認または取り消すことができます。許可を取り消すと、アプリ内のすべてのAI機能が無効になりますが、アプリのその他の部分は引き続き完全に機能します。</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>当社は、AIプロセッサが受け取るコンテンツとともに、アカウント識別子、連絡先情報、その他の個人識別子を送信することはありません。</li>
              <li>AIが生成する出力は推定値および概算です。不正確、不完全、または誤りを含む可能性があります。医療、臨床、または重要な食事上の判断に依拠すべきではありません。</li>
              <li>当社は、お客様のデータを第三者のAIモデルの学習に使用することに同意していません。プロバイダーは、各社の方針に従い、不正防止および診断のためにデータを一時的に保持する場合があります。</li>
              <li>AIプロバイダーの構成、使用される具体的なモデル、およびそれらの間のルーティングは変更される場合があります。このリストの重要な変更は、新しいプロバイダーがお客様のコンテンツを受け取る前に、アプリ内で新たな開示を表示します。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. 第三者サービスプロバイダー</h2>
            <p class="mb-3">当社は、アプリを運営するために次のカテゴリーのサービスプロバイダーを利用しています:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Firebase / Google Cloud Platform:</strong> 認証、同期された過去の血糖記録を含む安全なデータ保存、分析、クラッシュレポート。</li>
              <li><strong class="text-text-primary">Apple App Store:</strong> iOSアプリ経由で登録するユーザーのサブスクリプション課金。</li>
              <li><strong class="text-text-primary">Google Play:</strong> Androidアプリ経由で登録するユーザーのサブスクリプション課金。</li>
              <li><strong class="text-text-primary">Stripe:</strong> ウェブサイト経由で登録するユーザーのサブスクリプション課金および決済処理。Stripeはカード情報、請求先住所、および不透明なユーザー識別子を受け取ります。当社が受け取るのは顧客IDとサブスクリプションID、および大まかな状態のみです。</li>
              <li><strong class="text-text-primary">AIプロバイダー（Google Gemini、Anthropic Claude、OpenAI ChatGPT、xAI Grok）:</strong> AIによる食事分析、栄養推定、トレーニングプラン生成、対話機能。プロバイダーごとのリンクとアプリ内の許可フローについては第5条をご覧ください。</li>
              <li><strong class="text-text-primary">Apple HealthKit / Android Health Connect:</strong> お客様の明示的な許可による任意の健康データの同期。</li>
              <li><strong class="text-text-primary">CGMプロバイダー（Dexcom、Abbott、Nightscout）:</strong> お客様の明示的な許可による任意の持続血糖測定器データの連携。</li>
              <li><strong class="text-text-primary">栄養データソース:</strong> 栄養情報を充実させるための、公開またはライセンスされたデータベース。当社が送信するのは食品のコンテキストのみで、個人識別子は送信しません。</li>
            </ul>
            <p class="mt-3">すべてのプロセッサは、お客様の情報を保護し、当社の指示および適用される法律に従ってのみ使用することが義務付けられています。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. データの共有</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">販売しません:</strong> 当社はお客様の個人データを販売しません。コンテキストを越えた行動ターゲティング広告のために第三者とデータを共有することはありません。</li>
              <li><strong class="text-text-primary">サービスプロバイダー:</strong> アプリの提供に必要な範囲でのみ、機密保持およびセキュリティの義務のもとで共有します。</li>
              <li><strong class="text-text-primary">法令の遵守:</strong> 法律、召喚状、裁判所命令、政府の要請により求められる場合、または権利、安全、財産を保護するために開示が必要であると誠実に判断する場合、情報を開示することがあります。</li>
              <li><strong class="text-text-primary">集計データ:</strong> 個人と合理的に結びつけることができない、識別不可能な集計統計を共有する場合があります。</li>
              <li><strong class="text-text-primary">事業譲渡:</strong> 合併、買収、または資産売却の際に、お客様の情報がその取引の一部として移転される場合があります。そのような変更があった場合は通知します。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. データのセキュリティ</h2>
            <p>当社は、転送中（TLS）および保存時の暗号化、アクセス制御、最小権限の原則、業界標準のセキュリティ慣行を採用しています。ただし、電子的な転送または保存の方法に完全に安全なものはありません。当社はお客様のデータの絶対的な安全性を保証することはできず、また保証しません。お客様は自己の責任において本アプリを利用し、情報を送信するものとします。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. データの保持</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">アカウントデータ:</strong> アカウントが有効な間保持されます。アカウント削除を依頼すると、30日間の復旧期間が始まります。その期間の終了後、日次のクリーンアップ処理で稼働中のアカウントデータを削除します。ただし、法律上の義務または正当な業務目的（不正防止、財務記録など）により保持が必要な場合を除きます。</li>
              <li data-recovery-retention="true"><strong class="text-text-primary">復旧用コピーとローカルファイル:</strong> Firestoreの復旧用バージョンとバックアップは、稼働中のアカウントデータとは別に期限が切れます。特定時点への復旧用バージョンと日次バックアップの保持期間は7日、週次バックアップは98日です。同期の停止やアカウント削除の依頼によって、復旧用コピー、アプリのローカルキャッシュ、お客様や受取人がエクスポートしたファイルが即座に消去されるわけではありません。</li>
              <li><strong class="text-text-primary">購入記録:</strong> 財務、監査、不正防止の義務に必要な期間保持されます。</li>
              <li><strong class="text-text-primary">分析・診断:</strong> 通常は最長24か月保持されます。ただし、セキュリティまたは法令遵守のためにより長い保持が必要な場合を除きます。</li>
              <li>個々の記録（食事、ワークアウト、写真）は、アプリ内でいつでも削除できます。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. お客様の権利と選択肢</h2>
            <p class="mb-3">お住まいの法域によっては、次の権利を有する場合があります:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>当社が保有するお客様の個人データにアクセスする権利。</li>
              <li>不正確または不完全なデータを訂正する権利。</li>
              <li>アカウントおよび関連する個人データを削除する権利。</li>
              <li>データを一般的な機械可読形式でエクスポートする権利。</li>
              <li>同意を撤回する権利（HealthKitの許可、位置情報サービスなど）。</li>
              <li>利用可能な場合、必須でない分析をオプトアウトする権利。</li>
            </ul>
            <p class="mt-3">これらの権利を行使するには、アプリ内の設定を使用するか、下記の連絡先までご連絡ください。リクエストの処理前に本人確認が必要な場合があり、適用される法律で認められる範囲でリクエストをお断りすることがあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. カリフォルニア州の居住者（CCPA/CPRA）</h2>
            <p class="mb-3">カリフォルニア州の居住者の場合、California Consumer Privacy ActおよびCalifornia Privacy Rights Actに基づき、次の追加の権利を有します:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>どの個人情報が収集、使用、共有、または販売されているかを知る権利。</li>
              <li>当社が保有する個人情報を削除する権利。</li>
              <li>個人情報の販売または共有をオプトアウトする権利。当社は個人情報を販売しません。</li>
              <li>プライバシーの権利を行使したことによる差別を受けない権利。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. 消費者健康データ（ワシントン、ネバダ、コネチカット等の法律）</h2>
            <p class="mb-3">消費者健康データに関する法律——ワシントン州 My Health My Data Act（MHMDA）、ネバダ州 SB 370、コネチカット州 Data Privacy Act（改正を含む）など——のある州にお住まいの場合、本条では当社が「消費者健康データ」として扱う追加の情報カテゴリーと、その情報に関するお客様の権利を説明します。グルコース値、持続血糖測定器（CGM）の記録、および関連する代謝データは、お客様の居住州にかかわらず、本ポリシーにおいて消費者健康データとして扱われます。</p>
            <p class="mb-3"><strong class="text-text-primary">収集する消費者健康データのカテゴリー。</strong> グルコースの測定値およびCGMの傾向データ（現在および過去のもの。Apple Health、Android Health Connect、Dexcom Share、Abbott LibreLinkUp、Nightscoutからのインポート、または手動入力を問わない）、健康状態や治療パターンを明らかにし得る食べ物・飲み物・サプリメント・水分の記録、体重・体組成・生体測定値、症状・エネルギー・気分・睡眠・ウェルネスの記録、ワークアウト・心拍数・その他の身体活動の記録、ならびにお客様の過去・現在・将来の身体的または精神的な健康状態、症状、治療を特定するその他の情報。</p>
            <p class="mb-3"><strong class="text-text-primary">利用方法。</strong> 消費者健康データは、(i) お客様が明示的に有効にしたアプリ機能の提供、(ii) 複数のデバイス間でのデータ同期、(iii) お客様が要求した個人向けの栄養・ウェルネス・AIの要約の生成、(iv) アカウントのセキュリティ維持および不正防止——のためにのみ処理されます。当社は消費者健康データを販売せず、コンテキストを越えた行動ターゲティング広告のために第三者と共有せず、当社または他者のために広告のターゲティングに使用しません。</p>
            <p class="mb-3"><strong class="text-text-primary">共有。</strong> 消費者健康データは、第5条および第6条に記載されたプロセッサ（安全な保存のためのFirebase / Google Cloud Platform、お客様がAI機能を実際に使用する際のAIプロバイダー、課金のためのStripe / Apple——いずれもお客様について学習する目的で生のグルコースデータを受け取ることはありません）に対してのみ、かつアプリの提供または適用法の遵守に必要な範囲でのみ開示されます。</p>
            <p class="mb-3"><strong class="text-text-primary">お客様の権利。</strong> お客様は、(a) 当社がお客様の消費者健康データを収集・共有・販売しているかを確認し、当該データにアクセスする権利、(b) 消費者健康データの収集および共有への同意を撤回する権利、(c) 当社に代わってデータを保持するプロセッサからのものを含め、消費者健康データを削除させる権利、(d) お客様のリクエストに関する当社の決定に対して不服を申し立てる権利を有します。当社は消費者健康データを販売しないため、販売に対する別個のオプトアウトはありません。これらの権利を行使するには <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a> までご連絡ください。適用される州法で定められた期間内に対応します。リクエストを拒否した場合、その決定に件名に「Appeal」と記載して返信することで不服を申し立てることができ、また居住州の司法長官に苦情を申し立てることもできます。</p>
            <p class="mb-3"><strong class="text-text-primary">ジオフェンシング。</strong> StatsKeyは、医療施設、精神保健施設、リプロダクティブヘルス施設、または類似の場所の周囲にジオフェンスを使用しません。</p>
            <p><strong class="text-text-primary">共有の許可。</strong> 当社は、お客様の事前の書面による許可なく消費者健康データを共有または販売しません。CGMまたはHealthKitの連携を接続した場合、お客様は、有効にしたアプリ機能を提供するためにそのソースから消費者健康データを取得・処理し、削除するまでStatsKeyアカウントに保存することをStatsKeyに許可することになります。アプリ内で連携を停止するか端末の権限を取り消すと、そのインストールからの新たな取得は停止しますが、保存済みのアカウントデータが自動的に削除されるわけではありません。当社による継続的な収集や共有への同意を撤回する場合、または消費者健康データの削除を依頼する場合は、上記の手順でご連絡ください。設定からアカウントを削除することもできます。これらの依頼は、第9条、第10条および本条の権利と保持に関する規定に従って処理します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. EEA／英国の居住者（GDPR）</h2>
            <p class="mb-3">個人データの処理に関する当社の法的根拠には、次のものが含まれます:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">契約:</strong> アプリを提供し、お客様との契約を履行するため。</li>
              <li><strong class="text-text-primary">同意:</strong> HealthKitまたはHealth Connectへのアクセス、位置情報サービス、特定の分析のため。</li>
              <li><strong class="text-text-primary">正当な利益:</strong> アプリの安全性、不正防止、品質向上——お客様の権利と比較衡量したうえで。</li>
              <li><strong class="text-text-primary">法的義務:</strong> 適用される法律の遵守。</li>
            </ul>
            <p class="mt-3">当社は、米国およびその他の国でデータを処理・保存する場合があります。必要な場合、国際的な移転には適切な保護措置（標準契約条項など）を用います。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. 子どものプライバシー</h2>
            <p>StatsKeyは13歳未満の子どもを対象としていません。当社は13歳未満の子どもから故意に個人データを収集することはありません。子どもが当社に個人データを提供したと思われる場合は、ご連絡ください。速やかに削除します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. カメラと写真</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>カメラへのアクセスは、お客様が記録を選んだ食事の写真を撮影するためにのみ使用されます。</li>
              <li>写真は、食べ物を識別し栄養の推定値を生成するために処理されます。</li>
              <li>元の写真は、お客様がアプリと同期することを選択しない限り、デバイス上に残ります。</li>
              <li>当社は、お客様の明示的な許可なくフォトライブラリにアクセスすることはありません。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. 本ポリシーの変更</h2>
            <p>当社は本プライバシーポリシーを随時更新することがあります。重要な変更を行う場合は、アプリを通じて、またはその他の合理的な方法でお知らせします。変更の発効日以降にStatsKeyを継続して利用することは、更新後のポリシーへの同意とみなされます。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. お問い合わせ</h2>
            <p>本プライバシーポリシーに関するご質問、または権利の行使をご希望の場合:</p>
            <p class="mt-2"><strong class="text-text-primary">メール:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>
  `,
}

const pt = {
  __title: 'Política de Privacidade — StatsKey',
  'lp-title': 'Política de Privacidade',
  'lp-date':
    'Data de vigência: 5 de setembro de 2026<span class="block mt-2 italic">Esta tradução para o português é apenas informativa. Em caso de divergência, prevalece a versão original em inglês.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Introdução</h2>
            <p>A StatsKey ("StatsKey", "nós", "nos" ou "nosso") opera um aplicativo de acompanhamento de nutrição, fitness e dados biométricos. Esta Política de Privacidade descreve as informações que coletamos, como as usamos e compartilhamos, e quais são as suas opções. Ao usar o StatsKey, você concorda com as práticas descritas aqui. Se não concordar, não use o aplicativo.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Informações Que Coletamos</h2>
            <p class="mb-3"><strong class="text-text-primary">Informações da conta.</strong> Nome (opcional), endereço de e-mail, senha (armazenada como hash com sal pelo Firebase Authentication quando você se cadastra com e-mail e senha), identificadores de login federado (Apple ID ou Google) e um ID interno de usuário.</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de saúde e fitness.</strong> Refeições e registros de nutrição, fotos de alimentos e descrições em texto, atividades físicas, durações, estimativas de calorias, peso e medidas corporais, metas personalizadas, registros atuais e históricos de monitor contínuo de glicose (CGM) e de glicose, registros de bem-estar e — se você conceder permissão — dados do Apple HealthKit (no iOS) ou do Android Health Connect (no Android) (incluindo, entre outros, energia, macronutrientes, peso, frequência cardíaca, glicose e dados de treino).</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de localização.</strong> Se você ativar os serviços de localização, coletamos dados de GPS durante o registro ativo de um treino para acompanhar rota, distância, ritmo e elevação. O acesso à localização em segundo plano ocorre apenas enquanto uma sessão de treino está em andamento e cessa quando a sessão termina ou é pausada. Não coletamos dados de localização fora do registro de treinos.</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de assinatura e transação.</strong> Histórico de compras, status da assinatura, canal de cobrança (App Store, Google Play ou Stripe), tokens de recibo da Apple (para assinaturas da App Store), tokens de compra do Google Play (para assinaturas do Google Play), identificadores de cliente e de assinatura da Stripe (para assinaturas na web) e identificadores limitados de dispositivo e aplicativo usados para validação de recibos, conciliação de cobrança e prevenção de fraudes. Não armazenamos os dados completos do cartão de pagamento; os dados do cartão são processados e armazenados pela Apple, pelo Google ou pela Stripe.</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de dispositivo e uso.</strong> Modelo do dispositivo, versão do sistema operacional, versão do aplicativo, padrões de uso de recursos e dados de eventos de desempenho.</p>
            <p class="mb-3"><strong class="text-text-primary">Diagnósticos.</strong> Registros de falhas, relatórios de erros e diagnósticos de desempenho.</p>
            <p><strong class="text-text-primary">Comunicações de suporte.</strong> Mensagens e anexos que você envia aos nossos canais de suporte.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Como Usamos Suas Informações</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Prestação do serviço:</strong> Criação de conta, autenticação, sincronização de dados e funcionalidades principais do aplicativo.</li>
              <li><strong class="text-text-primary">Análise com IA:</strong> Processamento de fotos de alimentos, descrições em texto, mensagens de chat e registros históricos de saúde relevantes, incluindo registros de glicose, por meio de serviços de IA de terceiros para gerar estimativas nutricionais, resumos e respostas conversacionais. Esses resultados são apenas aproximações e não devem ser usados para decisões médicas, dietéticas ou clínicas.</li>
              <li><strong class="text-text-primary">Personalização:</strong> Adaptação de recomendações e metas com base no seu perfil e nos seus dados históricos.</li>
              <li><strong class="text-text-primary">Integrações de saúde:</strong> Leitura e/ou gravação de dados do Apple HealthKit (no iOS) ou do Android Health Connect (no Android) estritamente para fornecer os recursos de saúde e fitness que você ativar explicitamente, incluindo o uso do Apple Health ou do Health Connect como fonte opcional de glicose e outros registros históricos.</li>
              <li><strong class="text-text-primary">Análise e qualidade:</strong> Compreensão do uso de recursos, diagnóstico de erros e melhoria do desempenho do aplicativo.</li>
              <li><strong class="text-text-primary">Segurança e prevenção de fraudes:</strong> Validação de compras, prevenção de abusos e proteção das contas dos usuários.</li>
              <li><strong class="text-text-primary">Comunicações:</strong> Envio de avisos relacionados ao serviço (por exemplo, alterações no status da assinatura, mudanças relevantes nos termos). Também podemos enviar periodicamente novidades de produto, dicas e e-mails promocionais sobre o StatsKey, e obteremos seu consentimento para isso onde a lei exigir. Você pode interromper esses envios a qualquer momento usando o link de cancelamento de inscrição incluído em cada um desses e-mails; avisos relacionados ao serviço ainda podem ser enviados conforme necessário. Dados do HealthKit e de glicose nunca são usados para marketing.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Divulgação sobre o Apple HealthKit e o Android Health Connect</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Os dados acessados por meio do Apple HealthKit (iOS) ou do Android Health Connect (Android) são usados exclusivamente para fornecer ou melhorar recursos de saúde e fitness dentro do aplicativo, incluindo a importação de registros históricos de glicose quando você concede a permissão relevante do Apple Health ou do Health Connect.</li>
              <li>Esses dados de saúde nunca são usados para marketing, publicidade ou intermediação de dados (data brokering) e nunca são vendidos a nenhuma parte.</li>
              <li>Esses dados de saúde não são compartilhados com terceiros, exceto conforme necessário para processá-los em seu nome a fim de fornecer o serviço, e nunca para uso independente por essas partes.</li>
              <li>Os registros de glicose e outros registros de saúde que você opta por sincronizar podem ser copiados para sua conta StatsKey usando o Firebase / Google Cloud Platform, para que fiquem disponíveis em vários dispositivos e para os recursos habilitados do StatsKey, incluindo recursos de conversa com IA. Os registros clínicos/FHIR importados da Apple são tratados conforme descrito abaixo.</li>
              <li>Você pode revogar essas permissões a qualquer momento nas configurações do Apple Health (iOS) ou do Android Health Connect (Android). A revogação interrompe novos fluxos de dados, mas não exclui automaticamente os dados armazenados anteriormente — consulte a Seção 10 ("Seus Direitos").</li>
            </ul>
            <p class="mt-3" data-clinical-disclosure="1"><strong class="text-text-primary">Registros clínicos opcionais da Apple.</strong> O acesso clínico é opcional e não é necessário para pesquisar alimentos ou fazer registros manuais. Se você conceder a permissão separada da Apple para registros clínicos e ativar o Private Sync para sua conta StatsKey nesta instalação, a StatsKey copia os registros autorizados para sua conta. Eles podem incluir alergias, condições, imunizações, resultados laboratoriais, medicamentos, procedimentos, sinais vitais, cobertura de saúde e notas clínicas. A cópia inclui o conteúdo FHIR completo do prestador, que pode identificar você, além de datas e informações de origem.</p>
            <p class="mt-3" data-clinical-disclosure="2">Esses registros clínicos importados são usados para preservar seu histórico de saúde autorizado e incluí-lo nas exportações completas de dados que você inicia. A integração não oferece interpretação clínica nem um visualizador específico de registros clínicos, não acrescenta esses registros automaticamente ao contexto do Intelligence e não os compartilha pelo Friends ou pelo portal de profissionais de saúde. Você pode compartilhar uma exportação por conta própria. As informações que você digitar, colar ou anexar separadamente a uma solicitação de IA são tratadas como conteúdo dessa solicitação conforme a Seção 5.</p>
            <p class="mt-3" data-clinical-disclosure="3">A cópia da conta é armazenada no Google/Firebase Cloud Firestore nos Estados Unidos. O acesso normal pelo aplicativo exige login como titular da conta. O Google/Firebase fornece a infraestrutura de armazenamento, e identidades de serviço ou administradores da StatsKey com permissões privilegiadas na nuvem podem acessar os registros. Não há criptografia de ponta a ponta que impeça o acesso pelo operador do serviço. O aplicativo também pode manter registros no cache local do Firestore e criar arquivos locais de exportação; os originais permanecem no Apple Health.</p>
            <p class="mt-3" data-clinical-disclosure="4">Ative o recurso em Configurações → Saúde e corpo → Apple Health, concedendo acesso e escolhendo separadamente Enable and Sync para o Private Sync. Turn Off Private Sync, Stop Using Apple Health ou a revogação da permissão do Apple Health interrompe novos envios desta instalação, mantendo o histórico já copiado. Outras instalações têm opções próprias de sincronização. Solicite a exclusão ou exclua sua conta usando os controles e o processo de contato das Seções 9, 10 e 12; os arquivos exportados e compartilhados ficam sob seu controle ou o do destinatário.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Processamento por IA</h2>
            <p class="mb-3">Quando você usa um recurso com IA no aplicativo (chat do Intelligence, análise de fotos de alimentos, leitura de rótulos nutricionais, planos de treino gerados por IA, insights de nutrição gerados por IA), transmitimos o conteúdo de que o recurso ativo precisa a um ou mais processadores de IA terceirizados para que eles possam calcular uma resposta. O conjunto atual de processadores de IA é:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> — Gemini, acessado por meio do Firebase AI Logic e da API Google Generative AI. <a href="https://policies.google.com/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidade do Google</a>.</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> — Claude, acessado por meio da API da Anthropic. <a href="https://www.anthropic.com/legal/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidade da Anthropic</a>.</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> — modelos ChatGPT, acessados por meio da API da OpenAI (incluindo a Responses API para a análise de alimentos por imagem como alternativa). <a href="https://openai.com/policies/row-privacy-policy/" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidade da OpenAI</a>.</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> — Grok, acessado por meio da API da xAI. <a href="https://x.ai/legal/privacy-policy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidade da xAI</a>.</li>
            </ul>
            <p class="mb-3">As categorias de conteúdo pessoal que podemos transmitir aos provedores acima incluem: mensagens e prompts que você digita no chat de IA; fotos que você captura ou seleciona para análise de alimentos / rótulos nutricionais; resumos dos seus registros de nutrição, peso, hidratação, suplementos e glicose; registros históricos de glicose e tendências relacionadas quando relevantes para sua solicitação; resumos dos seus treinos, ritmo, frequência cardíaca e plano de treino; e campos básicos de perfil que você forneceu na configuração inicial (nome, sexo biológico, peso, altura, metas).</p>
            <p class="mb-3">Antes de transmitirmos qualquer conteúdo a esses processadores pela primeira vez, o app apresenta um aviso no aplicativo que identifica os processadores e as categorias de conteúdo acima e solicita sua permissão. Você pode revisar ou revogar essa permissão a qualquer momento em <em>Ajustes &rarr; IA e Privacidade &rarr; Recursos de IA</em>. Revogar a permissão desativa todos os recursos com IA do aplicativo, mantendo o restante do app totalmente funcional.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Não enviamos identificadores de conta, dados de contato ou outros identificadores pessoais junto com o conteúdo que os processadores de IA recebem.</li>
              <li>Os resultados gerados por IA são estimativas e aproximações. Podem ser imprecisos, incompletos ou incorretos. Você não deve confiar neles para decisões médicas, clínicas ou dietéticas críticas.</li>
              <li>Não optamos por permitir que seus dados sejam usados para treinar modelos de IA de terceiros. Os provedores podem reter dados temporariamente para prevenção de abusos e diagnósticos, de acordo com suas respectivas políticas.</li>
              <li>O conjunto de provedores de IA, os modelos específicos usados e o roteamento entre eles podem mudar. Mudanças relevantes nesta lista acionarão um novo aviso de permissão no aplicativo antes que o novo provedor receba qualquer conteúdo seu.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Prestadores de Serviço Terceirizados</h2>
            <p class="mb-3">Usamos as seguintes categorias de prestadores de serviço para operar o aplicativo:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Firebase / Google Cloud Platform:</strong> Autenticação, armazenamento seguro de dados, incluindo registros históricos de glicose sincronizados, análise e relatórios de falhas.</li>
              <li><strong class="text-text-primary">Apple App Store:</strong> Cobrança de assinaturas para usuários que assinam pelo app para iOS.</li>
              <li><strong class="text-text-primary">Google Play:</strong> Cobrança de assinaturas para usuários que assinam pelo app para Android.</li>
              <li><strong class="text-text-primary">Stripe:</strong> Cobrança de assinaturas e processamento de pagamentos para usuários que assinam pelo site. A Stripe recebe os dados do cartão, o endereço de cobrança e um identificador opaco de usuário; nós recebemos apenas os IDs de cliente e de assinatura e o status geral.</li>
              <li><strong class="text-text-primary">Provedores de IA (Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok):</strong> Análise de alimentos com IA, estimativa nutricional, geração de planos de treino e recursos conversacionais. Consulte a Seção 5 para os links por provedor e o fluxo de permissão no aplicativo.</li>
              <li><strong class="text-text-primary">Apple HealthKit e Android Health Connect:</strong> Sincronização opcional de dados de saúde com sua permissão explícita.</li>
              <li><strong class="text-text-primary">Provedores de CGM (Dexcom, Abbott, Nightscout):</strong> Integração opcional de dados de monitor contínuo de glicose com sua permissão explícita.</li>
              <li><strong class="text-text-primary">Fontes de dados nutricionais:</strong> Bancos de dados públicos ou licenciados para enriquecer as informações nutricionais. Transmitimos apenas o contexto do alimento, não identificadores pessoais.</li>
            </ul>
            <p class="mt-3">Todos os processadores são obrigados a proteger suas informações e a usá-las somente de acordo com nossas instruções e a legislação aplicável.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Compartilhamento de Dados</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Sem venda:</strong> Não vendemos seus dados pessoais. Não compartilhamos dados com terceiros para publicidade comportamental entre contextos.</li>
              <li><strong class="text-text-primary">Prestadores de serviço:</strong> Compartilhados apenas conforme necessário para fornecer o aplicativo, sujeitos a obrigações de confidencialidade e segurança.</li>
              <li><strong class="text-text-primary">Conformidade legal:</strong> Podemos divulgar informações se exigido por lei, intimação, ordem judicial ou solicitação governamental, ou se acreditarmos de boa-fé que a divulgação é necessária para proteger direitos, segurança ou propriedade.</li>
              <li><strong class="text-text-primary">Dados agregados:</strong> Podemos compartilhar estatísticas agregadas e não identificáveis que não possam ser razoavelmente vinculadas a nenhum indivíduo.</li>
              <li><strong class="text-text-primary">Transferências empresariais:</strong> No caso de fusão, aquisição ou venda de ativos, suas informações podem ser transferidas como parte dessa transação. Notificaremos você sobre qualquer alteração desse tipo.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Segurança dos Dados</h2>
            <p>Empregamos criptografia em trânsito (TLS) e em repouso, controles de acesso, princípios de privilégio mínimo e práticas de segurança padrão do setor. No entanto, nenhum método de transmissão ou armazenamento eletrônico é completamente seguro. Não podemos garantir e não garantimos a segurança absoluta dos seus dados. Você usa o aplicativo e transmite informações por sua conta e risco.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Retenção de Dados</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Dados da conta:</strong> Retidos enquanto sua conta estiver ativa. A solicitação de exclusão da conta inicia um período de recuperação de 30 dias. Após esse período, a limpeza diária remove os dados ativos da conta, exceto quando a retenção for exigida por lei ou para fins comerciais legítimos (por exemplo, prevenção de fraudes e registros financeiros).</li>
              <li data-recovery-retention="true"><strong class="text-text-primary">Cópias de recuperação e arquivos locais:</strong> As versões de recuperação e os backups do Firestore expiram separadamente dos dados ativos da conta: a recuperação pontual e os backups diários são retidos por sete dias; os backups semanais, por 98 dias. Desativar a sincronização ou solicitar a exclusão da conta não remove imediatamente as cópias de recuperação, o cache local do aplicativo ou os arquivos exportados por você ou por um destinatário.</li>
              <li><strong class="text-text-primary">Registros de compra:</strong> Retidos conforme exigido por obrigações financeiras, de auditoria e de prevenção de fraudes.</li>
              <li><strong class="text-text-primary">Análise e diagnósticos:</strong> Normalmente retidos por até 24 meses, salvo quando uma retenção mais longa for necessária por motivos de segurança ou conformidade legal.</li>
              <li>Você pode excluir entradas individuais (refeições, treinos, fotos) no aplicativo a qualquer momento.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Seus Direitos e Opções</h2>
            <p class="mb-3">Dependendo da sua jurisdição, você pode ter o direito de:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Acessar os dados pessoais que mantemos sobre você.</li>
              <li>Corrigir dados imprecisos ou incompletos.</li>
              <li>Excluir sua conta e os dados pessoais associados.</li>
              <li>Exportar seus dados em um formato comum e legível por máquina.</li>
              <li>Retirar o consentimento (por exemplo, permissões do HealthKit, serviços de localização).</li>
              <li>Recusar análises não essenciais quando disponível.</li>
            </ul>
            <p class="mt-3">Para exercer esses direitos, use as configurações do aplicativo ou entre em contato conosco no endereço abaixo. Podemos precisar verificar sua identidade antes de processar uma solicitação e podemos recusar solicitações quando permitido pela legislação aplicável.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Residentes da Califórnia (CCPA/CPRA)</h2>
            <p class="mb-3">Se você é residente da Califórnia, possui direitos adicionais sob a California Consumer Privacy Act e a California Privacy Rights Act, incluindo:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>O direito de saber quais informações pessoais são coletadas, usadas, compartilhadas ou vendidas.</li>
              <li>O direito de excluir as informações pessoais que mantemos.</li>
              <li>O direito de recusar a venda ou o compartilhamento de informações pessoais. Não vendemos informações pessoais.</li>
              <li>O direito à não discriminação por exercer seus direitos de privacidade.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Dados de Saúde do Consumidor (Washington, Nevada, Connecticut e leis semelhantes)</h2>
            <p class="mb-3">Se você é residente de um estado com lei de dados de saúde do consumidor — incluindo a Washington My Health My Data Act (MHMDA), a Nevada SB 370 e a Connecticut Data Privacy Act (conforme alterada) — esta seção descreve as categorias adicionais de informações que tratamos como "dados de saúde do consumidor" e os seus direitos em relação a essas informações. Valores de glicose, registros de monitor contínuo de glicose (CGM) e dados metabólicos relacionados são tratados como dados de saúde do consumidor sob esta Política de Privacidade, independentemente do seu estado de residência.</p>
            <p class="mb-3"><strong class="text-text-primary">Categorias de dados de saúde do consumidor que coletamos.</strong> Leituras de glicose e dados de tendência de CGM (atuais e históricos, sejam importados do Apple Health, Android Health Connect, Dexcom Share, Abbott LibreLinkUp, Nightscout ou inseridos manualmente); registros de comida, bebida, suplementos e hidratação que possam revelar condições de saúde ou padrões de tratamento; peso, composição corporal e medidas biométricas; registros de sintomas, energia, humor, sono e bem-estar; treinos, frequência cardíaca e outros registros de atividade física; e qualquer outra informação que você forneça que identifique seu estado, condições ou tratamentos de saúde física ou mental passados, presentes ou futuros.</p>
            <p class="mb-3"><strong class="text-text-primary">Como os usamos.</strong> Os dados de saúde do consumidor são processados apenas para (i) fornecer os recursos do aplicativo que você ativou explicitamente, (ii) sincronizar seus dados entre seus dispositivos, (iii) gerar os resumos pessoais de nutrição, bem-estar e IA que você solicita e (iv) manter a segurança da conta e prevenir abusos. Não vendemos dados de saúde do consumidor, não os compartilhamos com terceiros para publicidade comportamental entre contextos, nem os usamos para direcionar publicidade em nosso nome ou no de qualquer outra parte.</p>
            <p class="mb-3"><strong class="text-text-primary">Compartilhamento.</strong> Os dados de saúde do consumidor são divulgados apenas aos processadores descritos nas Seções 5 e 6 (Firebase / Google Cloud Platform para armazenamento seguro, provedores de IA quando você usa ativamente os recursos de IA, e Stripe / Apple para cobrança — nenhum dos quais recebe dados brutos de glicose com a finalidade de treinar modelos sobre você), e apenas conforme necessário para fornecer o aplicativo ou cumprir a legislação aplicável.</p>
            <p class="mb-3"><strong class="text-text-primary">Seus direitos.</strong> Você tem o direito de (a) confirmar se estamos coletando, compartilhando ou vendendo seus dados de saúde do consumidor e acessar esses dados, (b) retirar o consentimento para a nossa coleta e compartilhamento de dados de saúde do consumidor, (c) ter seus dados de saúde do consumidor excluídos, inclusive dos nossos processadores que mantêm os dados em nosso nome, e (d) recorrer de uma decisão que tomarmos sobre sua solicitação. Não vendemos dados de saúde do consumidor, portanto não há uma opção separada de recusa de venda a exercer. Para exercer esses direitos, entre em contato conosco em <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>; responderemos dentro dos prazos exigidos pela lei estadual aplicável. Se negarmos uma solicitação, você pode recorrer respondendo a essa decisão com a palavra "Appeal" na linha de assunto, e também pode apresentar uma reclamação ao procurador-geral do seu estado de residência.</p>
            <p class="mb-3"><strong class="text-text-primary">Geofencing.</strong> A StatsKey não usa cercas virtuais (geofences) ao redor de qualquer estabelecimento de saúde, instalação de saúde mental, clínica de saúde reprodutiva ou local semelhante.</p>
            <p><strong class="text-text-primary">Autorização para compartilhamento.</strong> Não compartilhamos nem vendemos dados de saúde do consumidor sem sua autorização prévia por escrito. Se você conectar uma integração de CGM ou HealthKit, está autorizando a StatsKey a recuperar e processar dados de saúde do consumidor dessa fonte para fornecer os recursos do aplicativo que você ativou, e a armazenar esses dados na sua conta StatsKey até que você os exclua. Desativar uma integração no aplicativo ou revogar suas permissões no dispositivo interrompe novas consultas desta instalação; isso não exclui, por si só, os dados da conta já armazenados. Para retirar o consentimento para nossa coleta ou compartilhamento contínuos, ou solicitar a exclusão de dados de saúde do consumidor, entre em contato pelo processo acima. A exclusão da conta também está disponível nas Configurações. Processamos essas solicitações conforme os direitos e as disposições de retenção das Seções 9, 10 e desta seção.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Residentes do EEE/Reino Unido (GDPR)</h2>
            <p class="mb-3">Nossas bases legais para o processamento de dados pessoais incluem:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Contrato:</strong> Para fornecer o aplicativo e cumprir nosso acordo com você.</li>
              <li><strong class="text-text-primary">Consentimento:</strong> Para acesso ao HealthKit ou ao Health Connect, serviços de localização e determinadas análises.</li>
              <li><strong class="text-text-primary">Interesses legítimos:</strong> Segurança do aplicativo, prevenção de fraudes, melhoria de qualidade — equilibrados com os seus direitos.</li>
              <li><strong class="text-text-primary">Obrigação legal:</strong> Cumprimento das leis aplicáveis.</li>
            </ul>
            <p class="mt-3">Podemos processar e armazenar dados nos Estados Unidos e em outros países. Onde exigido, usamos salvaguardas apropriadas (por exemplo, Cláusulas Contratuais Padrão) para transferências internacionais.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Privacidade Infantil</h2>
            <p>O StatsKey não é direcionado a crianças menores de 13 anos. Não coletamos intencionalmente dados pessoais de crianças menores de 13 anos. Se você acredita que uma criança nos forneceu dados pessoais, entre em contato conosco e os excluiremos prontamente.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Câmera e Fotos</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>O acesso à câmera é usado exclusivamente para capturar fotos de refeições que você opta por registrar.</li>
              <li>As fotos são processadas para identificar alimentos e gerar estimativas nutricionais.</li>
              <li>As fotos originais permanecem no seu dispositivo, a menos que você opte por sincronizá-las com o aplicativo.</li>
              <li>Não acessamos sua biblioteca de fotos sem sua permissão explícita.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Alterações nesta Política</h2>
            <p>Podemos atualizar esta Política de Privacidade periodicamente. Se fizermos mudanças relevantes, notificaremos você por meio do aplicativo ou por outros meios razoáveis. O uso contínuo do StatsKey após a data de vigência de quaisquer alterações constitui sua aceitação da política atualizada.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Contato</h2>
            <p>Se você tiver dúvidas sobre esta Política de Privacidade ou desejar exercer seus direitos:</p>
            <p class="mt-2"><strong class="text-text-primary">E-mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>
  `,
}

const es = {
  __title: 'Política de Privacidad — StatsKey',
  'lp-title': 'Política de Privacidad',
  'lp-date':
    'Fecha de entrada en vigor: 5 de septiembre de 2026<span class="block mt-2 italic">Esta traducción al español tiene únicamente fines informativos. En caso de discrepancia, prevalece la versión original en inglés.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Introducción</h2>
            <p>StatsKey («StatsKey», «nosotros» o «nuestro») opera una aplicación de seguimiento de nutrición, fitness y datos biométricos. Esta Política de Privacidad describe la información que recopilamos, cómo la usamos y compartimos, y las opciones de que dispones. Al usar StatsKey, aceptas las prácticas descritas aquí. Si no estás de acuerdo, no uses la aplicación.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Información que recopilamos</h2>
            <p class="mb-3"><strong class="text-text-primary">Información de la cuenta.</strong> Nombre (opcional), dirección de correo electrónico, contraseña (almacenada como hash con sal por Firebase Authentication cuando te registras con correo y contraseña), identificadores de inicio de sesión federado (Apple ID o Google) y un ID interno de usuario.</p>
            <p class="mb-3"><strong class="text-text-primary">Datos de salud y fitness.</strong> Comidas y registros de nutrición, fotos de alimentos y descripciones de texto, actividades físicas, duraciones, estimaciones calóricas, peso y medidas corporales, objetivos personalizados, registros actuales e históricos de monitor continuo de glucosa (MCG) y de glucosa, registros de bienestar y, si concedes permiso, datos de Apple HealthKit (en iOS) o de Android Health Connect (en Android) (incluidos, entre otros, energía, macronutrientes, peso, frecuencia cardíaca, glucosa y datos de entrenamiento).</p>
            <p class="mb-3"><strong class="text-text-primary">Datos de ubicación.</strong> Si activas los servicios de ubicación, recopilamos datos de GPS durante el registro activo de un entrenamiento para seguir la ruta, la distancia, el ritmo y el desnivel. El acceso a la ubicación en segundo plano solo se produce mientras una sesión de entrenamiento está en curso y cesa cuando la sesión finaliza o se pausa. No recopilamos datos de ubicación fuera del registro de entrenamientos.</p>
            <p class="mb-3"><strong class="text-text-primary">Datos de suscripción y transacciones.</strong> Historial de compras, estado de la suscripción, canal de facturación (App Store, Google Play o Stripe), tokens de recibo de Apple (para suscripciones de la App Store), tokens de compra de Google Play (para suscripciones de Google Play), identificadores de cliente y de suscripción de Stripe (para suscripciones web) e identificadores limitados de dispositivo y de aplicación utilizados para la validación de recibos, la conciliación de la facturación y la prevención del fraude. No almacenamos los datos completos de la tarjeta de pago; los datos de la tarjeta son procesados y almacenados por Apple, Google o Stripe.</p>
            <p class="mb-3"><strong class="text-text-primary">Datos de dispositivo y uso.</strong> Modelo del dispositivo, versión del sistema operativo, versión de la aplicación, patrones de uso de funciones y datos de eventos de rendimiento.</p>
            <p class="mb-3"><strong class="text-text-primary">Diagnósticos.</strong> Registros de fallos, informes de errores y diagnósticos de rendimiento.</p>
            <p><strong class="text-text-primary">Comunicaciones de soporte.</strong> Mensajes y archivos adjuntos que envías a nuestros canales de soporte.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Cómo usamos tu información</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Prestación del servicio:</strong> Creación de cuenta, autenticación, sincronización de datos y funciones principales de la aplicación.</li>
              <li><strong class="text-text-primary">Análisis con IA:</strong> Procesamiento de fotos de alimentos, descripciones de texto, mensajes de chat y registros históricos de salud relevantes, incluidos los registros de glucosa, a través de servicios de IA de terceros para generar estimaciones nutricionales, resúmenes y respuestas conversacionales. Estos resultados son solo aproximaciones y no deben utilizarse para decisiones médicas, dietéticas o clínicas.</li>
              <li><strong class="text-text-primary">Personalización:</strong> Adaptación de recomendaciones y objetivos según tu perfil y tus datos históricos.</li>
              <li><strong class="text-text-primary">Integraciones de salud:</strong> Lectura o escritura de datos de Apple HealthKit (en iOS) o de Android Health Connect (en Android) estrictamente para ofrecer las funciones de salud y fitness que actives de forma explícita, incluido el uso de Apple Health o Health Connect como fuente opcional de glucosa y otros registros históricos.</li>
              <li><strong class="text-text-primary">Análisis y calidad:</strong> Comprensión del uso de funciones, diagnóstico de errores y mejora del rendimiento de la aplicación.</li>
              <li><strong class="text-text-primary">Seguridad y prevención del fraude:</strong> Validación de compras, prevención de abusos y protección de las cuentas de los usuarios.</li>
              <li><strong class="text-text-primary">Comunicaciones:</strong> Envío de avisos relacionados con el servicio (p. ej., cambios en el estado de la suscripción, cambios sustanciales en los términos). También podemos enviarte periódicamente novedades del producto, consejos y correos promocionales sobre StatsKey, y obtendremos tu consentimiento para ello cuando la ley lo exija. Puedes detenerlos en cualquier momento mediante el enlace para darte de baja incluido en cada uno de esos correos; los avisos relacionados con el servicio podrán seguir enviándose según sea necesario. Los datos de HealthKit y de glucosa nunca se utilizan con fines de marketing.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Divulgación sobre Apple HealthKit y Android Health Connect</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Los datos a los que se accede mediante Apple HealthKit (iOS) o Android Health Connect (Android) se utilizan exclusivamente para ofrecer o mejorar funciones de salud y fitness dentro de la aplicación, incluida la importación de registros históricos de glucosa cuando concedes el permiso correspondiente de Apple Health o de Health Connect.</li>
              <li>Estos datos de salud nunca se utilizan para marketing, publicidad ni intermediación de datos, y nunca se venden a ninguna parte.</li>
              <li>Estos datos de salud no se comparten con terceros salvo en la medida necesaria para procesarlos en tu nombre con el fin de prestar el servicio, y nunca para uso independiente por parte de dichas partes.</li>
              <li>Los registros de glucosa y otros registros de salud que decidas sincronizar pueden respaldarse en tu cuenta de StatsKey mediante Firebase / Google Cloud Platform para que estén disponibles en varios dispositivos y en las funciones habilitadas de StatsKey, incluidas las funciones de conversación con IA. Los registros clínicos/FHIR importados de Apple se tratan como se describe a continuación.</li>
              <li>Puedes revocar estos permisos en cualquier momento desde los ajustes de Apple Health (iOS) o de Android Health Connect (Android). La revocación detiene nuevos flujos de datos, pero no elimina automáticamente los datos almacenados previamente; consulta la Sección 10 («Tus derechos»).</li>
            </ul>
            <p class="mt-3" data-clinical-disclosure="1"><strong class="text-text-primary">Registros clínicos opcionales de Apple.</strong> El acceso clínico es opcional y no es necesario para buscar alimentos ni registrar datos manualmente. Si concedes el permiso independiente de Apple para los registros clínicos y activas Private Sync para tu cuenta StatsKey en esta instalación, StatsKey copia los registros autorizados a tu cuenta. Pueden incluir alergias, afecciones, vacunas, resultados de laboratorio, medicamentos, procedimientos, constantes vitales, cobertura sanitaria y notas clínicas. La copia incluye el contenido FHIR completo del proveedor, que puede identificarte, junto con fechas e información de origen.</p>
            <p class="mt-3" data-clinical-disclosure="2">Estos registros clínicos importados se utilizan para conservar tu historial de salud autorizado e incluirlo en las exportaciones completas de datos que tú inicias. La integración no ofrece interpretación clínica ni un visor específico de registros clínicos, no añade estos registros automáticamente al contexto de Intelligence ni los comparte mediante Friends o el portal para profesionales clínicos. Puedes compartir una exportación por tu cuenta. La información que escribas, pegues o adjuntes por separado a una solicitud de IA se trata como contenido de esa solicitud conforme a la Sección 5.</p>
            <p class="mt-3" data-clinical-disclosure="3">La copia de la cuenta se almacena en Google/Firebase Cloud Firestore en Estados Unidos. El acceso normal desde la aplicación exige iniciar sesión como titular de la cuenta. Google/Firebase proporciona la infraestructura de almacenamiento, y las identidades de servicio o los administradores de StatsKey con permisos privilegiados en la nube pueden acceder a los registros. No están cifrados de extremo a extremo frente al operador del servicio. La aplicación también puede conservar registros en su caché local de Firestore y crear archivos locales de exportación; los originales permanecen en Apple Health.</p>
            <p class="mt-3" data-clinical-disclosure="4">Activa esta función en Ajustes → Salud y cuerpo → Apple Health, concediendo acceso y eligiendo por separado Enable and Sync para Private Sync. Turn Off Private Sync, Stop Using Apple Health o revocar el permiso de Apple Health detiene las nuevas cargas desde esta instalación y conserva el historial ya copiado. Otras instalaciones tienen sus propias opciones de sincronización. Solicita la eliminación o elimina tu cuenta mediante los controles y el proceso de contacto de las Secciones 9, 10 y 12; los archivos que exportes y compartas quedan bajo tu control o el del destinatario.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Procesamiento por IA</h2>
            <p class="mb-3">Cuando usas una función con IA en la app (chat de Intelligence, análisis de fotos de alimentos, escaneo de etiquetas nutricionales, planes de entrenamiento generados por IA, información nutricional generada por IA), transmitimos el contenido que necesita la función activa a uno o más procesadores de IA de terceros para que puedan calcular una respuesta. El conjunto actual de procesadores de IA es:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> — Gemini, al que se accede a través de Firebase AI Logic y la API de Google Generative AI. <a href="https://policies.google.com/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidad de Google</a>.</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> — Claude, al que se accede a través de la API de Anthropic. <a href="https://www.anthropic.com/legal/privacy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidad de Anthropic</a>.</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> — modelos ChatGPT, a los que se accede a través de la API de OpenAI (incluida la Responses API para el análisis de alimentos por imagen como alternativa). <a href="https://openai.com/policies/row-privacy-policy/" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidad de OpenAI</a>.</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> — Grok, al que se accede a través de la API de xAI. <a href="https://x.ai/legal/privacy-policy" class="text-accent hover:underline" target="_blank" rel="noopener">Política de Privacidad de xAI</a>.</li>
            </ul>
            <p class="mb-3">Las categorías de contenido personal que podemos transmitir a los proveedores anteriores incluyen: mensajes e indicaciones que escribes en el chat de IA; fotos que capturas o seleccionas para el análisis de alimentos o etiquetas nutricionales; resúmenes de tus registros de nutrición, peso, hidratación, suplementos y glucosa; registros históricos de glucosa y tendencias relacionadas cuando son relevantes para tu solicitud; resúmenes de tus entrenamientos, ritmo, frecuencia cardíaca y plan de entrenamiento; y campos básicos de perfil que proporcionaste durante la configuración inicial (nombre, sexo biológico, peso, altura, objetivos).</p>
            <p class="mb-3">Antes de transmitir cualquier contenido a estos procesadores por primera vez, la app muestra un aviso dentro de la aplicación que nombra a los procesadores y las categorías de contenido anteriores y te pide permiso. Puedes revisar o revocar este permiso en cualquier momento desde <em>Ajustes &rarr; IA y Privacidad &rarr; Funciones de IA</em>. Revocar el permiso desactiva todas las funciones con IA de la app, manteniendo el resto de la aplicación plenamente funcional.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>No enviamos identificadores de cuenta, datos de contacto ni otros identificadores personales junto con el contenido que reciben los procesadores de IA.</li>
              <li>Los resultados generados por IA son estimaciones y aproximaciones. Pueden ser inexactos, incompletos o incorrectos. No debes basarte en ellos para decisiones médicas, clínicas o dietéticas críticas.</li>
              <li>No aceptamos que tus datos se utilicen para entrenar modelos de IA de terceros. Los proveedores pueden conservar datos de forma temporal para la prevención de abusos y el diagnóstico, de acuerdo con sus respectivas políticas.</li>
              <li>El conjunto de proveedores de IA, los modelos concretos utilizados y el enrutamiento entre ellos pueden cambiar. Los cambios sustanciales en esta lista activarán un nuevo aviso dentro de la app antes de que el nuevo proveedor reciba cualquier contenido tuyo.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Proveedores de servicios de terceros</h2>
            <p class="mb-3">Utilizamos las siguientes categorías de proveedores de servicios para operar la aplicación:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Firebase / Google Cloud Platform:</strong> Autenticación, almacenamiento seguro de datos, incluidos los registros históricos de glucosa sincronizados, análisis e informes de fallos.</li>
              <li><strong class="text-text-primary">Apple App Store:</strong> Facturación de suscripciones para los usuarios que se suscriben a través de la app de iOS.</li>
              <li><strong class="text-text-primary">Google Play:</strong> Facturación de suscripciones para los usuarios que se suscriben a través de la app de Android.</li>
              <li><strong class="text-text-primary">Stripe:</strong> Facturación de suscripciones y procesamiento de pagos para los usuarios que se suscriben a través del sitio web. Stripe recibe los datos de la tarjeta, la dirección de facturación y un identificador opaco de usuario; nosotros solo recibimos los ID de cliente y de suscripción y el estado general.</li>
              <li><strong class="text-text-primary">Proveedores de IA (Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok):</strong> Análisis de alimentos con IA, estimación nutricional, generación de planes de entrenamiento y funciones conversacionales. Consulta la Sección 5 para ver los enlaces de cada proveedor y el flujo de permisos dentro de la app.</li>
              <li><strong class="text-text-primary">Apple HealthKit y Android Health Connect:</strong> Sincronización opcional de datos de salud con tu permiso explícito.</li>
              <li><strong class="text-text-primary">Proveedores de MCG (Dexcom, Abbott, Nightscout):</strong> Integración opcional de datos de monitor continuo de glucosa con tu permiso explícito.</li>
              <li><strong class="text-text-primary">Fuentes de datos nutricionales:</strong> Bases de datos públicas o con licencia para enriquecer la información nutricional. Transmitimos únicamente el contexto del alimento, no identificadores personales.</li>
            </ul>
            <p class="mt-3">Todos los procesadores están obligados a proteger tu información y a usarla únicamente conforme a nuestras instrucciones y a la legislación aplicable.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Compartición de datos</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Sin venta:</strong> No vendemos tus datos personales. No compartimos datos con terceros para publicidad conductual de contexto cruzado.</li>
              <li><strong class="text-text-primary">Proveedores de servicios:</strong> Se comparten solo en la medida necesaria para prestar la aplicación, con obligaciones de confidencialidad y seguridad.</li>
              <li><strong class="text-text-primary">Cumplimiento legal:</strong> Podemos divulgar información si así lo exige la ley, una citación, una orden judicial o una solicitud gubernamental, o si creemos de buena fe que la divulgación es necesaria para proteger derechos, la seguridad o la propiedad.</li>
              <li><strong class="text-text-primary">Datos agregados:</strong> Podemos compartir estadísticas agregadas y no identificables que no puedan vincularse razonablemente con ninguna persona.</li>
              <li><strong class="text-text-primary">Transferencias empresariales:</strong> En caso de fusión, adquisición o venta de activos, tu información podría transferirse como parte de esa operación. Te notificaremos cualquier cambio de este tipo.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Seguridad de los datos</h2>
            <p>Empleamos cifrado en tránsito (TLS) y en reposo, controles de acceso, principios de mínimo privilegio y prácticas de seguridad estándar del sector. No obstante, ningún método de transmisión o almacenamiento electrónico es completamente seguro. No podemos garantizar ni garantizamos la seguridad absoluta de tus datos. Usas la aplicación y transmites información bajo tu propio riesgo.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Conservación de datos</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Datos de la cuenta:</strong> Se conservan mientras tu cuenta esté activa. Solicitar la eliminación de la cuenta inicia un período de recuperación de 30 días. Al terminar ese período, la limpieza diaria elimina los datos activos de la cuenta, salvo cuando la conservación sea obligatoria por ley o necesaria para fines comerciales legítimos (por ejemplo, prevención del fraude y registros financieros).</li>
              <li data-recovery-retention="true"><strong class="text-text-primary">Copias de recuperación y archivos locales:</strong> Las versiones de recuperación y las copias de seguridad de Firestore caducan por separado de los datos activos de la cuenta: la recuperación a un momento dado y las copias diarias se conservan siete días; las copias semanales, 98 días. Desactivar la sincronización o solicitar la eliminación de la cuenta no borra inmediatamente las copias de recuperación, la caché local de la aplicación ni los archivos que tú o un destinatario hayáis exportado.</li>
              <li><strong class="text-text-primary">Registros de compra:</strong> Se conservan según lo exijan las obligaciones financieras, de auditoría y de prevención del fraude.</li>
              <li><strong class="text-text-primary">Análisis y diagnósticos:</strong> Normalmente se conservan hasta 24 meses, salvo que se requiera una conservación más prolongada por motivos de seguridad o cumplimiento legal.</li>
              <li>Puedes eliminar entradas individuales (comidas, entrenamientos, fotos) dentro de la aplicación en cualquier momento.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Tus derechos y opciones</h2>
            <p class="mb-3">Según tu jurisdicción, es posible que tengas derecho a:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>Acceder a los datos personales que tenemos sobre ti.</li>
              <li>Corregir datos inexactos o incompletos.</li>
              <li>Eliminar tu cuenta y los datos personales asociados.</li>
              <li>Exportar tus datos en un formato común y legible por máquina.</li>
              <li>Retirar el consentimiento (p. ej., permisos de HealthKit, servicios de ubicación).</li>
              <li>Rechazar análisis no esenciales cuando estén disponibles.</li>
            </ul>
            <p class="mt-3">Para ejercer estos derechos, utiliza los ajustes de la aplicación o contáctanos en la dirección indicada a continuación. Es posible que necesitemos verificar tu identidad antes de tramitar una solicitud y podemos rechazar solicitudes cuando lo permita la legislación aplicable.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Residentes de California (CCPA/CPRA)</h2>
            <p class="mb-3">Si resides en California, dispones de derechos adicionales en virtud de la California Consumer Privacy Act y la California Privacy Rights Act, entre ellos:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>El derecho a saber qué información personal se recopila, usa, comparte o vende.</li>
              <li>El derecho a eliminar la información personal que tengamos.</li>
              <li>El derecho a rechazar la venta o la compartición de información personal. No vendemos información personal.</li>
              <li>El derecho a no ser discriminado por ejercer tus derechos de privacidad.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Datos de salud del consumidor (Washington, Nevada, Connecticut y leyes similares)</h2>
            <p class="mb-3">Si resides en un estado con una ley de datos de salud del consumidor —incluidas la Washington My Health My Data Act (MHMDA), la Nevada SB 370 y la Connecticut Data Privacy Act (en su versión modificada)—, esta sección describe las categorías adicionales de información que tratamos como «datos de salud del consumidor» y tus derechos respecto de esa información. Los valores de glucosa, los registros de monitor continuo de glucosa (MCG) y los datos metabólicos relacionados se tratan como datos de salud del consumidor en virtud de esta Política de Privacidad con independencia de tu estado de residencia.</p>
            <p class="mb-3"><strong class="text-text-primary">Categorías de datos de salud del consumidor que recopilamos.</strong> Lecturas de glucosa y datos de tendencia de MCG (actuales e históricos, ya sean importados de Apple Health, Android Health Connect, Dexcom Share, Abbott LibreLinkUp, Nightscout o introducidos manualmente); registros de comida, bebida, suplementos e hidratación que puedan revelar condiciones de salud o patrones de tratamiento; peso, composición corporal y medidas biométricas; registros de síntomas, energía, estado de ánimo, sueño y bienestar; registros de entrenamiento, frecuencia cardíaca y otra actividad física; y cualquier otra información que proporciones y que identifique tu estado, condiciones o tratamientos de salud física o mental pasados, presentes o futuros.</p>
            <p class="mb-3"><strong class="text-text-primary">Cómo los usamos.</strong> Los datos de salud del consumidor se procesan únicamente para (i) ofrecer las funciones de la aplicación que hayas activado de forma explícita, (ii) sincronizar tus datos entre tus dispositivos, (iii) generar los resúmenes personales de nutrición, bienestar e IA que solicitas y (iv) mantener la seguridad de la cuenta y prevenir abusos. No vendemos datos de salud del consumidor, no los compartimos con terceros para publicidad conductual de contexto cruzado ni los usamos para segmentar publicidad en nuestro nombre ni en el de nadie más.</p>
            <p class="mb-3"><strong class="text-text-primary">Compartición.</strong> Los datos de salud del consumidor solo se divulgan a los procesadores descritos en las Secciones 5 y 6 (Firebase / Google Cloud Platform para almacenamiento seguro, proveedores de IA cuando usas activamente las funciones de IA, y Stripe / Apple para la facturación; ninguno de ellos recibe datos brutos de glucosa con el fin de entrenar modelos sobre ti), y solo en la medida necesaria para prestar la aplicación o cumplir la legislación aplicable.</p>
            <p class="mb-3"><strong class="text-text-primary">Tus derechos.</strong> Tienes derecho a (a) confirmar si recopilamos, compartimos o vendemos tus datos de salud del consumidor y acceder a esos datos, (b) retirar el consentimiento para nuestra recopilación y compartición de datos de salud del consumidor, (c) que se eliminen tus datos de salud del consumidor, incluidos los que conservan en nuestro nombre nuestros procesadores, y (d) recurrir una decisión que tomemos sobre tu solicitud. No vendemos datos de salud del consumidor, por lo que no existe una opción de exclusión de venta independiente que ejercer. Para ejercer estos derechos, contáctanos en <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>; responderemos dentro de los plazos exigidos por la ley estatal aplicable. Si denegamos una solicitud, puedes recurrir respondiendo a esa decisión con la palabra «Appeal» en la línea de asunto, y también puedes presentar una reclamación ante el fiscal general de tu estado de residencia.</p>
            <p class="mb-3"><strong class="text-text-primary">Geovallas.</strong> StatsKey no utiliza geovallas alrededor de ningún centro sanitario, centro de salud mental, centro de salud reproductiva o lugar similar.</p>
            <p><strong class="text-text-primary">Autorización para compartir.</strong> No compartimos ni vendemos datos de salud del consumidor sin tu autorización previa por escrito. Si conectas una integración de MCG o de HealthKit, autorizas a StatsKey a recuperar y procesar datos de salud del consumidor de esa fuente para ofrecer las funciones de la aplicación que hayas activado, y a almacenar esos datos en tu cuenta de StatsKey hasta que los elimines. Desactivar una integración en la aplicación o revocar sus permisos en el dispositivo detiene las nuevas consultas desde esa instalación; no elimina por sí solo los datos de la cuenta ya almacenados. Para retirar el consentimiento para nuestra recopilación o compartición continuadas, o solicitar la eliminación de datos de salud del consumidor, contáctanos mediante el proceso anterior. La eliminación de la cuenta también está disponible en Ajustes. Procesamos estas solicitudes conforme a los derechos y las disposiciones de conservación de las Secciones 9, 10 y esta sección.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Residentes del EEE/Reino Unido (RGPD)</h2>
            <p class="mb-3">Nuestras bases jurídicas para el tratamiento de datos personales incluyen:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Contrato:</strong> Para prestar la aplicación y cumplir nuestro acuerdo contigo.</li>
              <li><strong class="text-text-primary">Consentimiento:</strong> Para el acceso a HealthKit o Health Connect, los servicios de ubicación y determinados análisis.</li>
              <li><strong class="text-text-primary">Intereses legítimos:</strong> Seguridad de la aplicación, prevención del fraude, mejora de la calidad, ponderados frente a tus derechos.</li>
              <li><strong class="text-text-primary">Obligación legal:</strong> Cumplimiento de las leyes aplicables.</li>
            </ul>
            <p class="mt-3">Podemos procesar y almacenar datos en los Estados Unidos y en otros países. Cuando es necesario, utilizamos salvaguardas adecuadas (p. ej., Cláusulas Contractuales Tipo) para las transferencias internacionales.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Privacidad de los menores</h2>
            <p>StatsKey no está dirigido a menores de 13 años. No recopilamos a sabiendas datos personales de menores de 13 años. Si crees que un menor nos ha proporcionado datos personales, contáctanos y los eliminaremos de inmediato.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Cámara y fotos</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>El acceso a la cámara se utiliza únicamente para capturar las fotos de comidas que decidas registrar.</li>
              <li>Las fotos se procesan para identificar alimentos y generar estimaciones nutricionales.</li>
              <li>Las fotos originales permanecen en tu dispositivo salvo que decidas sincronizarlas con la aplicación.</li>
              <li>No accedemos a tu fototeca sin tu permiso explícito.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Cambios en esta política</h2>
            <p>Podemos actualizar esta Política de Privacidad de vez en cuando. Si realizamos cambios sustanciales, te lo notificaremos a través de la aplicación o por otros medios razonables. El uso continuado de StatsKey tras la fecha de entrada en vigor de cualquier cambio constituye tu aceptación de la política actualizada.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Contacto</h2>
            <p>Si tienes preguntas sobre esta Política de Privacidad o deseas ejercer tus derechos:</p>
            <p class="mt-2"><strong class="text-text-primary">Correo electrónico:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>
  `,
}

applyI18n({ es, de, ja, pt })
