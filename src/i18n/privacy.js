import { applyI18n } from './legal.js'

// German / Japanese translations of the Privacy Policy. Structure and CSS
// classes mirror the English markup in privacy.html exactly; only text changes.
// English remains the authoritative version (see the dated disclaimer line).

const de = {
  __title: 'Datenschutzerklärung — StatsKey',
  'lp-title': 'Datenschutzerklärung',
  'lp-date':
    'Gültig ab: 10. Juni 2026<span class="block mt-2 italic">Diese deutsche Übersetzung dient nur zur Information. Bei Abweichungen ist die englische Originalfassung maßgeblich.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Einleitung</h2>
            <p>StatsKey („StatsKey“, „wir“, „uns“ oder „unser“) betreibt eine Anwendung zur Erfassung von Ernährung, Fitness und biometrischen Daten. Diese Datenschutzerklärung beschreibt, welche Informationen wir erheben, wie wir sie verwenden und weitergeben und welche Wahlmöglichkeiten du hast. Durch die Nutzung von StatsKey stimmst du den hier beschriebenen Praktiken zu. Wenn du nicht einverstanden bist, nutze die Anwendung nicht.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Welche Informationen wir erheben</h2>
            <p class="mb-3"><strong class="text-text-primary">Kontoinformationen.</strong> Name (optional), E-Mail-Adresse, Passwort (bei der Registrierung mit E-Mail und Passwort als gesalzener Hash über Firebase Authentication gespeichert), Identifikatoren für föderierte Anmeldung (Apple-ID oder Google) sowie eine interne Nutzer-ID.</p>
            <p class="mb-3"><strong class="text-text-primary">Gesundheits- und Fitnessdaten.</strong> Mahlzeiten und Ernährungseinträge, Essensfotos und Textbeschreibungen, sportliche Aktivitäten, Dauer, Kalorienschätzungen, Gewicht und Körperwerte, eigene Ziele, aktuelle und historische Daten von kontinuierlichen Glukosemessgeräten (CGM) und Glukoseeinträge, Wellness-Protokolle und – sofern du die Berechtigung erteilst – Daten aus Apple HealthKit (einschließlich, aber nicht beschränkt auf Energie, Makronährstoffe, Gewicht, Herzfrequenz, Glukose und Workout-Daten).</p>
            <p class="mb-3"><strong class="text-text-primary">Standortdaten.</strong> Wenn du die Standortdienste aktivierst, erfassen wir während der aktiven Workout-Aufzeichnung GPS-Daten, um Route, Distanz, Pace und Höhenmeter zu verfolgen. Ein Standortzugriff im Hintergrund erfolgt nur, während eine Workout-Sitzung läuft, und endet, wenn die Sitzung beendet oder pausiert wird. Außerhalb der Workout-Aufzeichnung erheben wir keine Standortdaten.</p>
            <p class="mb-3"><strong class="text-text-primary">Abonnement- und Transaktionsdaten.</strong> Kaufhistorie, Abostatus, Abrechnungskanal (App Store oder Stripe), Apple-Beleg-Tokens (für App-Store-Abos), Stripe-Kunden- und Abonnement-IDs (für Web-Abos) sowie begrenzte Geräte- und Anwendungskennungen zur Belegprüfung, Abrechnungsabstimmung und Betrugsprävention. Wir speichern keine vollständigen Zahlungskartendaten; Kartendaten werden von Apple oder Stripe verarbeitet und gespeichert.</p>
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
              <li><strong class="text-text-primary">Gesundheitsintegrationen:</strong> Lesen und/oder Schreiben von HealthKit-Daten ausschließlich, um von dir ausdrücklich aktivierte Gesundheits- und Fitnessfunktionen bereitzustellen, einschließlich der Nutzung von Apple Health als optionale Quelle für Glukose- und andere historische Daten.</li>
              <li><strong class="text-text-primary">Analyse und Qualität:</strong> Verständnis der Funktionsnutzung, Fehlerdiagnose und Verbesserung der Anwendungsleistung.</li>
              <li><strong class="text-text-primary">Sicherheit und Betrugsprävention:</strong> Prüfung von Käufen, Verhinderung von Missbrauch und Schutz von Nutzerkonten.</li>
              <li><strong class="text-text-primary">Kommunikation:</strong> Versand von servicebezogenen Hinweisen (z. B. Änderungen des Abostatus, wesentliche Änderungen der Bedingungen). Wir können dir auch in regelmäßigen Abständen Produktneuigkeiten, Tipps und Werbe-E-Mails zu StatsKey senden und holen, wo gesetzlich erforderlich, deine Einwilligung dafür ein. Du kannst diese jederzeit über den Abmeldelink in jeder solchen E-Mail beenden; servicebezogene Hinweise können bei Bedarf weiterhin gesendet werden. HealthKit- und Glukosedaten werden niemals für Marketing verwendet.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Offenlegung zu Apple HealthKit</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>HealthKit-Daten werden ausschließlich verwendet, um Gesundheits- und Fitnessfunktionen innerhalb der Anwendung bereitzustellen oder zu verbessern, einschließlich des Imports historischer Glukosedaten, wenn du die entsprechende Apple-Health-Berechtigung erteilst.</li>
              <li>HealthKit-Daten werden niemals für Marketing, Werbung oder Datenhandel verwendet und niemals an Dritte verkauft.</li>
              <li>HealthKit-Daten werden nur insoweit an Dritte weitergegeben, wie es zu ihrer Verarbeitung in deinem Auftrag zur Bereitstellung des Dienstes erforderlich ist, und niemals zur eigenständigen Nutzung durch diese Parteien.</li>
              <li>Glukose- und andere HealthKit-Daten, die du synchronisierst, können über Firebase / Google Cloud Platform in deinem StatsKey-Konto gesichert werden, damit sie geräteübergreifend und für aktivierte StatsKey-Funktionen, einschließlich KI-Dialogfunktionen, verfügbar sind.</li>
              <li>Du kannst Health-Berechtigungen jederzeit über die Apple-Health-Einstellungen widerrufen. Ein Widerruf stoppt neue Datenflüsse, löscht jedoch zuvor gespeicherte Daten nicht automatisch – siehe Abschnitt 10 („Deine Rechte“).</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. KI-Verarbeitung</h2>
            <p class="mb-3">Wenn du eine KI-gestützte Funktion in der App nutzt (Intelligence-Chat, Essensfoto-Analyse, Nährwertetiketten-Scan, KI-generierte Trainingspläne, KI-generierte Ernährungs-Einblicke), übermitteln wir die für die aktive Funktion erforderlichen Inhalte an einen oder mehrere KI-Verarbeiter von Drittanbietern, damit diese eine Antwort berechnen können. Die aktuellen KI-Verarbeiter sind:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> – Gemini, zugänglich über Firebase AI Logic und die Google Generative AI API. <a href="https://policies.google.com/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von Google</a>.</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> – Claude, zugänglich über die API von Anthropic. <a href="https://www.anthropic.com/legal/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von Anthropic</a>.</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> – ChatGPT-Modelle, zugänglich über die OpenAI-API (einschließlich der Responses-API für die bildbasierte Essensanalyse als Fallback). <a href="https://openai.com/policies/row-privacy-policy/" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von OpenAI</a>.</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> – Grok, zugänglich über die xAI-API. <a href="https://x.ai/legal/privacy-policy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Datenschutzerklärung von xAI</a>.</li>
            </ul>
            <p class="mb-3">Zu den Kategorien personenbezogener Inhalte, die wir an die oben genannten Anbieter übermitteln können, gehören: Nachrichten und Eingaben, die du in den KI-Chat tippst; Fotos, die du für die Essens- bzw. Nährwertetiketten-Analyse aufnimmst oder auswählst; Zusammenfassungen deiner Ernährungs-, Gewichts-, Flüssigkeits-, Nahrungsergänzungs- und Glukose-Protokolle; historische Glukosedaten und zugehörige Trends, sofern für deine Anfrage relevant; Zusammenfassungen deiner Workouts, Pace, Herzfrequenz und Trainingspläne; sowie grundlegende Profilfelder aus dem Onboarding (Name, biologisches Geschlecht, Gewicht, Größe, Ziele).</p>
            <p class="mb-3">Bevor wir Inhalte zum ersten Mal an diese Verarbeiter übermitteln, zeigt die iOS-App einen In-App-Hinweis, der die Verarbeiter und die oben genannten Inhaltskategorien benennt und dich um deine Erlaubnis bittet. Du kannst diese Erlaubnis jederzeit unter <em>Einstellungen &rarr; KI &amp; Datenschutz &rarr; KI-Funktionen</em> einsehen oder widerrufen. Ein Widerruf deaktiviert jede KI-gestützte Funktion der App, während der Rest der App voll funktionsfähig bleibt.</p>
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
              <li><strong class="text-text-primary">Stripe:</strong> Abrechnung von Abonnements und Zahlungsabwicklung für Nutzer, die über die Website abonnieren. Stripe erhält Kartendaten, Rechnungsadresse und eine pseudonyme Nutzerkennung; wir erhalten nur Kunden- und Abonnement-IDs sowie einen groben Status.</li>
              <li><strong class="text-text-primary">KI-Anbieter (Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok):</strong> KI-gestützte Essensanalyse, Nährwertschätzung, Erstellung von Trainingsplänen und Dialogfunktionen. Siehe Abschnitt 5 für die Links je Anbieter und den In-App-Berechtigungsablauf.</li>
              <li><strong class="text-text-primary">Apple HealthKit:</strong> Optionale Synchronisierung von Gesundheitsdaten mit deiner ausdrücklichen Erlaubnis.</li>
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
              <li><strong class="text-text-primary">Kontodaten:</strong> Werden gespeichert, solange dein Konto aktiv ist. Nach Kontolöschung löschen oder anonymisieren wir die zugehörigen personenbezogenen Daten innerhalb von 30 Tagen, sofern keine Aufbewahrung gesetzlich vorgeschrieben oder für berechtigte Geschäftszwecke (z. B. Betrugsprävention, Finanzunterlagen) erforderlich ist.</li>
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
            <p class="mb-3"><strong class="text-text-primary">Kategorien der erhobenen Verbraucher-Gesundheitsdaten.</strong> Glukosewerte und CGM-Trenddaten (aktuell und historisch, ob aus Apple Health, Dexcom Share, Abbott LibreLinkUp, Nightscout importiert oder manuell eingegeben); Protokolle zu Lebensmitteln, Getränken, Nahrungsergänzung und Flüssigkeitszufuhr, die Gesundheitszustände oder Behandlungsmuster offenbaren können; Gewicht, Körperzusammensetzung und biometrische Messungen; Protokolle zu Symptomen, Energie, Stimmung, Schlaf und Wellness; Workout-, Herzfrequenz- und andere Aktivitätsdaten; sowie alle weiteren Informationen, die du bereitstellst und die deinen vergangenen, gegenwärtigen oder zukünftigen körperlichen oder psychischen Gesundheitszustand, Erkrankungen oder Behandlungen identifizieren.</p>
            <p class="mb-3"><strong class="text-text-primary">Wie wir sie verwenden.</strong> Verbraucher-Gesundheitsdaten werden nur verarbeitet, um (i) die von dir ausdrücklich aktivierten Anwendungsfunktionen bereitzustellen, (ii) deine Daten geräteübergreifend zu synchronisieren, (iii) die von dir angeforderten persönlichen Ernährungs-, Wellness- und KI-Zusammenfassungen zu erstellen und (iv) die Kontosicherheit aufrechtzuerhalten und Missbrauch zu verhindern. Wir verkaufen keine Verbraucher-Gesundheitsdaten, geben sie nicht für kontextübergreifende verhaltensbasierte Werbung weiter und verwenden sie nicht für gezielte Werbung in unserem oder fremdem Namen.</p>
            <p class="mb-3"><strong class="text-text-primary">Weitergabe.</strong> Verbraucher-Gesundheitsdaten werden nur an die in den Abschnitten 5 und 6 beschriebenen Verarbeiter weitergegeben (Firebase / Google Cloud Platform für sichere Speicherung, KI-Anbieter, wenn du KI-Funktionen aktiv nutzt, und Stripe / Apple für die Abrechnung – keiner davon erhält rohe Glukosedaten zum Zweck des Trainings von Modellen über dich) und nur, soweit dies zur Bereitstellung der Anwendung oder zur Einhaltung geltenden Rechts erforderlich ist.</p>
            <p class="mb-3"><strong class="text-text-primary">Deine Rechte.</strong> Du hast das Recht, (a) zu bestätigen, ob wir deine Verbraucher-Gesundheitsdaten erheben, weitergeben oder verkaufen, und auf diese Daten zuzugreifen, (b) deine Einwilligung in die Erhebung und Weitergabe von Verbraucher-Gesundheitsdaten zu widerrufen, (c) deine Verbraucher-Gesundheitsdaten löschen zu lassen, auch bei unseren Verarbeitern, die die Daten in unserem Auftrag halten, und (d) gegen eine Entscheidung zu deiner Anfrage Einspruch einzulegen. Wir verkaufen keine Verbraucher-Gesundheitsdaten, sodass kein separates Widerspruchsrecht gegen einen Verkauf besteht. Um diese Rechte auszuüben, kontaktiere uns unter <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>; wir antworten innerhalb der nach dem jeweiligen Landesrecht erforderlichen Fristen. Wenn wir eine Anfrage ablehnen, kannst du Einspruch einlegen, indem du auf diese Entscheidung mit dem Wort „Appeal“ in der Betreffzeile antwortest, und du kannst zudem eine Beschwerde beim Generalstaatsanwalt deines Wohnsitzstaates einreichen.</p>
            <p class="mb-3"><strong class="text-text-primary">Geofencing.</strong> StatsKey verwendet keine Geofences um Gesundheitseinrichtungen, Einrichtungen für psychische Gesundheit, Einrichtungen für reproduktive Gesundheit oder ähnliche Orte.</p>
            <p><strong class="text-text-primary">Autorisierung zur Weitergabe.</strong> Wir geben Verbraucher-Gesundheitsdaten ohne deine vorherige schriftliche Autorisierung weder weiter noch verkaufen wir sie. Wenn du eine CGM- oder HealthKit-Integration verbindest, autorisierst du StatsKey, Verbraucher-Gesundheitsdaten aus dieser Quelle abzurufen und zu verarbeiten, um die von dir aktivierten Anwendungsfunktionen bereitzustellen, und diese Daten in deinem StatsKey-Konto zu speichern, bis du sie löschst. Du kannst diese Autorisierung jederzeit widerrufen, indem du die Integration in der Anwendung trennst oder uns eine E-Mail schreibst; der Widerruf stoppt den weiteren Datenabruf und löst eine Löschung gemäß Abschnitt 9 aus.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Einwohner des EWR / Vereinigten Königreichs (DSGVO)</h2>
            <p class="mb-3">Unsere Rechtsgrundlagen für die Verarbeitung personenbezogener Daten umfassen:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Vertrag:</strong> Zur Bereitstellung der Anwendung und zur Erfüllung unserer Vereinbarung mit dir.</li>
              <li><strong class="text-text-primary">Einwilligung:</strong> Für HealthKit-Zugriff, Standortdienste und bestimmte Analysen.</li>
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
    '発効日: 2026年6月10日<span class="block mt-2 italic">この日本語訳は参考用です。内容に相違がある場合は、英語の原文が優先されます。</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. はじめに</h2>
            <p>StatsKey（以下「StatsKey」「当社」）は、栄養、フィットネス、生体データを記録するアプリケーションを運営しています。本プライバシーポリシーは、当社が収集する情報、その使用および共有の方法、ならびにお客様の選択肢について説明します。StatsKeyを利用することにより、お客様はここに記載された取り扱いに同意するものとします。同意されない場合は、本アプリケーションを利用しないでください。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. 当社が収集する情報</h2>
            <p class="mb-3"><strong class="text-text-primary">アカウント情報。</strong> 氏名（任意）、メールアドレス、パスワード（メールとパスワードで登録した場合、Firebase Authenticationによりソルト付きハッシュとして保存されます）、フェデレーションサインインの識別子（Apple IDまたはGoogle）、および内部ユーザーID。</p>
            <p class="mb-3"><strong class="text-text-primary">健康・フィットネスデータ。</strong> 食事および栄養の記録、食べ物の写真とテキストによる説明、運動アクティビティ、所要時間、カロリーの推定値、体重および身体測定値、カスタム目標、持続血糖測定器（CGM）の現在および過去のデータと血糖の記録、ウェルネスの記録、ならびに——お客様が許可した場合——Apple HealthKitのデータ（エネルギー、マクロ栄養素、体重、心拍数、グルコース、ワークアウトデータを含みますが、これらに限られません）。</p>
            <p class="mb-3"><strong class="text-text-primary">位置情報データ。</strong> 位置情報サービスを有効にした場合、当社はワークアウトの記録中にGPSデータを収集し、ルート、距離、ペース、標高を記録します。バックグラウンドでの位置情報アクセスは、ワークアウトのセッション進行中にのみ行われ、セッションが終了または一時停止されると停止します。ワークアウトの記録以外で位置情報を収集することはありません。</p>
            <p class="mb-3"><strong class="text-text-primary">サブスクリプション・取引データ。</strong> 購入履歴、サブスクリプションの状態、課金チャネル（App StoreまたはStripe）、Appleのレシートトークン（App Storeのサブスクリプション用）、Stripeの顧客およびサブスクリプションID（ウェブのサブスクリプション用）、ならびにレシートの検証、課金の照合、不正防止に使用される限定的なデバイスおよびアプリの識別子。当社は完全な支払いカード情報を保存しません。カード情報はAppleまたはStripeによって処理・保存されます。</p>
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
              <li><strong class="text-text-primary">健康連携:</strong> お客様が明示的に有効にした健康・フィットネス機能を提供するためだけにHealthKitデータを読み取りおよび／または書き込みます。これには、グルコースやその他の過去の記録の任意のソースとしてApple Healthを使用することを含みます。</li>
              <li><strong class="text-text-primary">分析と品質:</strong> 機能の利用状況の把握、エラーの診断、アプリのパフォーマンス向上。</li>
              <li><strong class="text-text-primary">セキュリティと不正防止:</strong> 購入の検証、不正利用の防止、ユーザーアカウントの保護。</li>
              <li><strong class="text-text-primary">連絡:</strong> サービスに関する通知（サブスクリプション状態の変更、規約の重要な変更など）の送信。法律で必要な場合に同意を得たうえで、StatsKeyに関する製品情報、ヒント、プロモーションメールを定期的に送信することがあります。これらは各メールに含まれる配信停止リンクからいつでも停止できます。サービスに関する通知は必要に応じて引き続き送信される場合があります。HealthKitおよびグルコースのデータがマーケティングに使用されることはありません。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Apple HealthKitに関する開示</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>HealthKitのデータは、お客様が該当するApple Healthの許可を与えた場合の過去の血糖記録のインポートを含め、アプリ内の健康・フィットネス機能を提供または改善するためにのみ使用されます。</li>
              <li>HealthKitのデータが、マーケティング、広告、データブローカーのために使用されることは決してなく、いかなる相手にも販売されることはありません。</li>
              <li>HealthKitのデータは、サービスを提供するためにお客様に代わって処理するために必要な場合を除き第三者と共有されることはなく、それらの当事者が独自に利用することは決してありません。</li>
              <li>お客様が同期を選択したグルコースおよびその他のHealthKitの記録は、Firebase / Google Cloud Platformを使用してStatsKeyアカウントにバックアップされ、複数のデバイスや、AIの会話機能を含む有効なStatsKey機能で利用できるようになる場合があります。</li>
              <li>Healthの許可は、Apple Healthの設定からいつでも取り消すことができます。取り消しは新たなデータの流れを停止しますが、以前に保存されたデータが自動的に削除されるわけではありません——第10条（「お客様の権利」）をご覧ください。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. AIによる処理</h2>
            <p class="mb-3">アプリ内でAI機能（Intelligenceチャット、食事写真分析、栄養ラベルのスキャン、AIによるトレーニングプラン生成、AIによる栄養インサイト生成）を利用すると、当社はその機能に必要なコンテンツを、応答を計算するために1つ以上の第三者AIプロセッサに送信します。現在のAIプロセッサは次のとおりです:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> — Gemini（Firebase AI LogicおよびGoogle Generative AI API経由でアクセス）。<a href="https://policies.google.com/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Googleプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> — Claude（AnthropicのAPI経由でアクセス）。<a href="https://www.anthropic.com/legal/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Anthropicプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> — ChatGPTモデル（OpenAI API経由でアクセス。画像ベースの食事分析のフォールバック用のResponses APIを含む）。<a href="https://openai.com/policies/row-privacy-policy/" class="text-teal-600 hover:underline" target="_blank" rel="noopener">OpenAIプライバシーポリシー</a>。</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> — Grok（xAI API経由でアクセス）。<a href="https://x.ai/legal/privacy-policy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">xAIプライバシーポリシー</a>。</li>
            </ul>
            <p class="mb-3">上記のプロバイダーに送信する可能性のある個人的なコンテンツのカテゴリーには、次のものが含まれます: AIチャットに入力したメッセージやプロンプト、食事／栄養ラベルの分析のために撮影または選択した写真、栄養・体重・水分・サプリメント・グルコースの記録の要約、リクエストに関連する場合の過去の血糖記録および関連する傾向、ワークアウト・ペース・心拍数・トレーニングプランの要約、ならびにオンボーディングで入力した基本的なプロフィール項目（氏名、生物学的性別、体重、身長、目標）。</p>
            <p class="mb-3">これらのプロセッサに初めてコンテンツを送信する前に、iOSアプリはプロセッサ名と上記のコンテンツのカテゴリーを示すアプリ内の開示を表示し、許可を求めます。この許可は <em>設定 &rarr; AIとプライバシー &rarr; AI機能</em> からいつでも確認または取り消すことができます。許可を取り消すと、アプリ内のすべてのAI機能が無効になりますが、アプリのその他の部分は引き続き完全に機能します。</p>
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
              <li><strong class="text-text-primary">Stripe:</strong> ウェブサイト経由で登録するユーザーのサブスクリプション課金および決済処理。Stripeはカード情報、請求先住所、および不透明なユーザー識別子を受け取ります。当社が受け取るのは顧客IDとサブスクリプションID、および大まかな状態のみです。</li>
              <li><strong class="text-text-primary">AIプロバイダー（Google Gemini、Anthropic Claude、OpenAI ChatGPT、xAI Grok）:</strong> AIによる食事分析、栄養推定、トレーニングプラン生成、対話機能。プロバイダーごとのリンクとアプリ内の許可フローについては第5条をご覧ください。</li>
              <li><strong class="text-text-primary">Apple HealthKit:</strong> お客様の明示的な許可による任意の健康データの同期。</li>
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
              <li><strong class="text-text-primary">アカウントデータ:</strong> アカウントが有効な間保持されます。アカウント削除後、関連する個人データは30日以内に削除または非識別化されます。ただし、法律で保持が義務付けられている場合、または正当な業務目的（不正防止、財務記録など）に必要な場合を除きます。</li>
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
            <p class="mb-3"><strong class="text-text-primary">収集する消費者健康データのカテゴリー。</strong> グルコースの測定値およびCGMの傾向データ（現在および過去のもの。Apple Health、Dexcom Share、Abbott LibreLinkUp、Nightscoutからのインポート、または手動入力を問わない）、健康状態や治療パターンを明らかにし得る食べ物・飲み物・サプリメント・水分の記録、体重・体組成・生体測定値、症状・エネルギー・気分・睡眠・ウェルネスの記録、ワークアウト・心拍数・その他の身体活動の記録、ならびにお客様の過去・現在・将来の身体的または精神的な健康状態、症状、治療を特定するその他の情報。</p>
            <p class="mb-3"><strong class="text-text-primary">利用方法。</strong> 消費者健康データは、(i) お客様が明示的に有効にしたアプリ機能の提供、(ii) 複数のデバイス間でのデータ同期、(iii) お客様が要求した個人向けの栄養・ウェルネス・AIの要約の生成、(iv) アカウントのセキュリティ維持および不正防止——のためにのみ処理されます。当社は消費者健康データを販売せず、コンテキストを越えた行動ターゲティング広告のために第三者と共有せず、当社または他者のために広告のターゲティングに使用しません。</p>
            <p class="mb-3"><strong class="text-text-primary">共有。</strong> 消費者健康データは、第5条および第6条に記載されたプロセッサ（安全な保存のためのFirebase / Google Cloud Platform、お客様がAI機能を実際に使用する際のAIプロバイダー、課金のためのStripe / Apple——いずれもお客様について学習する目的で生のグルコースデータを受け取ることはありません）に対してのみ、かつアプリの提供または適用法の遵守に必要な範囲でのみ開示されます。</p>
            <p class="mb-3"><strong class="text-text-primary">お客様の権利。</strong> お客様は、(a) 当社がお客様の消費者健康データを収集・共有・販売しているかを確認し、当該データにアクセスする権利、(b) 消費者健康データの収集および共有への同意を撤回する権利、(c) 当社に代わってデータを保持するプロセッサからのものを含め、消費者健康データを削除させる権利、(d) お客様のリクエストに関する当社の決定に対して不服を申し立てる権利を有します。当社は消費者健康データを販売しないため、販売に対する別個のオプトアウトはありません。これらの権利を行使するには <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a> までご連絡ください。適用される州法で定められた期間内に対応します。リクエストを拒否した場合、その決定に件名に「Appeal」と記載して返信することで不服を申し立てることができ、また居住州の司法長官に苦情を申し立てることもできます。</p>
            <p class="mb-3"><strong class="text-text-primary">ジオフェンシング。</strong> StatsKeyは、医療施設、精神保健施設、リプロダクティブヘルス施設、または類似の場所の周囲にジオフェンスを使用しません。</p>
            <p><strong class="text-text-primary">共有の許可。</strong> 当社は、お客様の事前の書面による許可なく消費者健康データを共有または販売しません。CGMまたはHealthKitの連携を接続した場合、お客様は、有効にしたアプリ機能を提供するためにそのソースから消費者健康データを取得・処理し、削除するまでStatsKeyアカウントに保存することをStatsKeyに許可することになります。この許可は、アプリ内で連携を解除するか、当社にメールを送ることでいつでも撤回できます。撤回は新たなデータ取得を停止し、第9条に基づく削除を発動します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. EEA／英国の居住者（GDPR）</h2>
            <p class="mb-3">個人データの処理に関する当社の法的根拠には、次のものが含まれます:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">契約:</strong> アプリを提供し、お客様との契約を履行するため。</li>
              <li><strong class="text-text-primary">同意:</strong> HealthKitへのアクセス、位置情報サービス、特定の分析のため。</li>
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
    'Em vigor a partir de: 10 de junho de 2026<span class="block mt-2 italic">Esta tradução para o português é apenas informativa. Em caso de divergência, prevalece a versão original em inglês.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Introdução</h2>
            <p>A StatsKey ("StatsKey", "nós", "nos" ou "nosso") opera um aplicativo de acompanhamento de nutrição, fitness e dados biométricos. Esta Política de Privacidade descreve as informações que coletamos, como as usamos e compartilhamos, e quais são as suas opções. Ao usar o StatsKey, você concorda com as práticas descritas aqui. Se não concordar, não use o aplicativo.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Informações Que Coletamos</h2>
            <p class="mb-3"><strong class="text-text-primary">Informações da conta.</strong> Nome (opcional), endereço de e-mail, senha (armazenada como hash com sal pelo Firebase Authentication quando você se cadastra com e-mail e senha), identificadores de login federado (Apple ID ou Google) e um ID interno de usuário.</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de saúde e fitness.</strong> Refeições e registros de nutrição, fotos de alimentos e descrições em texto, atividades físicas, durações, estimativas de calorias, peso e medidas corporais, metas personalizadas, registros atuais e históricos de monitor contínuo de glicose (CGM) e de glicose, registros de bem-estar e — se você conceder permissão — dados do Apple HealthKit (incluindo, entre outros, energia, macronutrientes, peso, frequência cardíaca, glicose e dados de treino).</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de localização.</strong> Se você ativar os serviços de localização, coletamos dados de GPS durante o registro ativo de um treino para acompanhar rota, distância, ritmo e elevação. O acesso à localização em segundo plano ocorre apenas enquanto uma sessão de treino está em andamento e cessa quando a sessão termina ou é pausada. Não coletamos dados de localização fora do registro de treinos.</p>
            <p class="mb-3"><strong class="text-text-primary">Dados de assinatura e transação.</strong> Histórico de compras, status da assinatura, canal de cobrança (App Store ou Stripe), tokens de recibo da Apple (para assinaturas da App Store), identificadores de cliente e de assinatura da Stripe (para assinaturas na web) e identificadores limitados de dispositivo e aplicativo usados para validação de recibos, conciliação de cobrança e prevenção de fraudes. Não armazenamos os dados completos do cartão de pagamento; os dados do cartão são processados e armazenados pela Apple ou pela Stripe.</p>
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
              <li><strong class="text-text-primary">Integrações de saúde:</strong> Leitura e/ou gravação de dados do HealthKit estritamente para fornecer os recursos de saúde e fitness que você ativar explicitamente, incluindo o uso do Apple Health como fonte opcional de glicose e outros registros históricos.</li>
              <li><strong class="text-text-primary">Análise e qualidade:</strong> Compreensão do uso de recursos, diagnóstico de erros e melhoria do desempenho do aplicativo.</li>
              <li><strong class="text-text-primary">Segurança e prevenção de fraudes:</strong> Validação de compras, prevenção de abusos e proteção das contas dos usuários.</li>
              <li><strong class="text-text-primary">Comunicações:</strong> Envio de avisos relacionados ao serviço (por exemplo, alterações no status da assinatura, mudanças relevantes nos termos). Também podemos enviar periodicamente novidades de produto, dicas e e-mails promocionais sobre o StatsKey, e obteremos seu consentimento para isso onde a lei exigir. Você pode interromper esses envios a qualquer momento usando o link de cancelamento de inscrição incluído em cada um desses e-mails; avisos relacionados ao serviço ainda podem ser enviados conforme necessário. Dados do HealthKit e de glicose nunca são usados para marketing.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Divulgação sobre o Apple HealthKit</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Os dados do HealthKit são usados exclusivamente para fornecer ou melhorar recursos de saúde e fitness dentro do aplicativo, incluindo a importação de registros históricos de glicose quando você concede a permissão relevante do Apple Health.</li>
              <li>Os dados do HealthKit nunca são usados para marketing, publicidade ou intermediação de dados (data brokering) e nunca são vendidos a nenhuma parte.</li>
              <li>Os dados do HealthKit não são compartilhados com terceiros, exceto conforme necessário para processá-los em seu nome a fim de fornecer o serviço, e nunca para uso independente por essas partes.</li>
              <li>Os registros de glicose e outros registros do HealthKit que você opta por sincronizar podem ser copiados para sua conta StatsKey usando o Firebase / Google Cloud Platform, para que fiquem disponíveis em vários dispositivos e para os recursos habilitados do StatsKey, incluindo recursos de conversa com IA.</li>
              <li>Você pode revogar as permissões do Health a qualquer momento nas configurações do Apple Health. A revogação interrompe novos fluxos de dados, mas não exclui automaticamente os dados armazenados anteriormente — consulte a Seção 10 ("Seus Direitos").</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Processamento por IA</h2>
            <p class="mb-3">Quando você usa um recurso com IA no aplicativo (chat do Intelligence, análise de fotos de alimentos, leitura de rótulos nutricionais, planos de treino gerados por IA, insights de nutrição gerados por IA), transmitimos o conteúdo de que o recurso ativo precisa a um ou mais processadores de IA terceirizados para que eles possam calcular uma resposta. O conjunto atual de processadores de IA é:</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Google LLC</strong> — Gemini, acessado por meio do Firebase AI Logic e da API Google Generative AI. <a href="https://policies.google.com/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Política de Privacidade do Google</a>.</li>
              <li><strong class="text-text-primary">Anthropic, PBC</strong> — Claude, acessado por meio da API da Anthropic. <a href="https://www.anthropic.com/legal/privacy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Política de Privacidade da Anthropic</a>.</li>
              <li><strong class="text-text-primary">OpenAI OpCo, LLC</strong> — modelos ChatGPT, acessados por meio da API da OpenAI (incluindo a Responses API para a análise de alimentos por imagem como alternativa). <a href="https://openai.com/policies/row-privacy-policy/" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Política de Privacidade da OpenAI</a>.</li>
              <li><strong class="text-text-primary">xAI Corp.</strong> — Grok, acessado por meio da API da xAI. <a href="https://x.ai/legal/privacy-policy" class="text-teal-600 hover:underline" target="_blank" rel="noopener">Política de Privacidade da xAI</a>.</li>
            </ul>
            <p class="mb-3">As categorias de conteúdo pessoal que podemos transmitir aos provedores acima incluem: mensagens e prompts que você digita no chat de IA; fotos que você captura ou seleciona para análise de alimentos / rótulos nutricionais; resumos dos seus registros de nutrição, peso, hidratação, suplementos e glicose; registros históricos de glicose e tendências relacionadas quando relevantes para sua solicitação; resumos dos seus treinos, ritmo, frequência cardíaca e plano de treino; e campos básicos de perfil que você forneceu na configuração inicial (nome, sexo biológico, peso, altura, metas).</p>
            <p class="mb-3">Antes de transmitirmos qualquer conteúdo a esses processadores pela primeira vez, o app para iOS apresenta um aviso no aplicativo que identifica os processadores e as categorias de conteúdo acima e solicita sua permissão. Você pode revisar ou revogar essa permissão a qualquer momento em <em>Ajustes &rarr; IA e Privacidade &rarr; Recursos de IA</em>. Revogar a permissão desativa todos os recursos com IA do aplicativo, mantendo o restante do app totalmente funcional.</p>
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
              <li><strong class="text-text-primary">Stripe:</strong> Cobrança de assinaturas e processamento de pagamentos para usuários que assinam pelo site. A Stripe recebe os dados do cartão, o endereço de cobrança e um identificador opaco de usuário; nós recebemos apenas os IDs de cliente e de assinatura e o status geral.</li>
              <li><strong class="text-text-primary">Provedores de IA (Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok):</strong> Análise de alimentos com IA, estimativa nutricional, geração de planos de treino e recursos conversacionais. Consulte a Seção 5 para os links por provedor e o fluxo de permissão no aplicativo.</li>
              <li><strong class="text-text-primary">Apple HealthKit:</strong> Sincronização opcional de dados de saúde com sua permissão explícita.</li>
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
              <li><strong class="text-text-primary">Dados da conta:</strong> Retidos enquanto sua conta estiver ativa. Após a exclusão da conta, excluímos ou desidentificamos os dados pessoais associados em até 30 dias, exceto quando a retenção for exigida por lei ou para fins comerciais legítimos (por exemplo, prevenção de fraudes, registros financeiros).</li>
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
            <p class="mb-3"><strong class="text-text-primary">Categorias de dados de saúde do consumidor que coletamos.</strong> Leituras de glicose e dados de tendência de CGM (atuais e históricos, sejam importados do Apple Health, Dexcom Share, Abbott LibreLinkUp, Nightscout ou inseridos manualmente); registros de comida, bebida, suplementos e hidratação que possam revelar condições de saúde ou padrões de tratamento; peso, composição corporal e medidas biométricas; registros de sintomas, energia, humor, sono e bem-estar; treinos, frequência cardíaca e outros registros de atividade física; e qualquer outra informação que você forneça que identifique seu estado, condições ou tratamentos de saúde física ou mental passados, presentes ou futuros.</p>
            <p class="mb-3"><strong class="text-text-primary">Como os usamos.</strong> Os dados de saúde do consumidor são processados apenas para (i) fornecer os recursos do aplicativo que você ativou explicitamente, (ii) sincronizar seus dados entre seus dispositivos, (iii) gerar os resumos pessoais de nutrição, bem-estar e IA que você solicita e (iv) manter a segurança da conta e prevenir abusos. Não vendemos dados de saúde do consumidor, não os compartilhamos com terceiros para publicidade comportamental entre contextos, nem os usamos para direcionar publicidade em nosso nome ou no de qualquer outra parte.</p>
            <p class="mb-3"><strong class="text-text-primary">Compartilhamento.</strong> Os dados de saúde do consumidor são divulgados apenas aos processadores descritos nas Seções 5 e 6 (Firebase / Google Cloud Platform para armazenamento seguro, provedores de IA quando você usa ativamente os recursos de IA, e Stripe / Apple para cobrança — nenhum dos quais recebe dados brutos de glicose com a finalidade de treinar modelos sobre você), e apenas conforme necessário para fornecer o aplicativo ou cumprir a legislação aplicável.</p>
            <p class="mb-3"><strong class="text-text-primary">Seus direitos.</strong> Você tem o direito de (a) confirmar se estamos coletando, compartilhando ou vendendo seus dados de saúde do consumidor e acessar esses dados, (b) retirar o consentimento para a nossa coleta e compartilhamento de dados de saúde do consumidor, (c) ter seus dados de saúde do consumidor excluídos, inclusive dos nossos processadores que mantêm os dados em nosso nome, e (d) recorrer de uma decisão que tomarmos sobre sua solicitação. Não vendemos dados de saúde do consumidor, portanto não há uma opção separada de recusa de venda a exercer. Para exercer esses direitos, entre em contato conosco em <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a>; responderemos dentro dos prazos exigidos pela lei estadual aplicável. Se negarmos uma solicitação, você pode recorrer respondendo a essa decisão com a palavra "Appeal" na linha de assunto, e também pode apresentar uma reclamação ao procurador-geral do seu estado de residência.</p>
            <p class="mb-3"><strong class="text-text-primary">Geofencing.</strong> A StatsKey não usa cercas virtuais (geofences) ao redor de qualquer estabelecimento de saúde, instalação de saúde mental, clínica de saúde reprodutiva ou local semelhante.</p>
            <p><strong class="text-text-primary">Autorização para compartilhamento.</strong> Não compartilhamos nem vendemos dados de saúde do consumidor sem sua autorização prévia por escrito. Se você conectar uma integração de CGM ou HealthKit, está autorizando a StatsKey a recuperar e processar dados de saúde do consumidor dessa fonte para fornecer os recursos do aplicativo que você ativou, e a armazenar esses dados na sua conta StatsKey até que você os exclua. Você pode revogar essa autorização a qualquer momento desconectando a integração no aplicativo ou enviando-nos um e-mail; a revogação interrompe a recuperação de novos dados e aciona a exclusão conforme a Seção 9.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Residentes do EEE/Reino Unido (GDPR)</h2>
            <p class="mb-3">Nossas bases legais para o processamento de dados pessoais incluem:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Contrato:</strong> Para fornecer o aplicativo e cumprir nosso acordo com você.</li>
              <li><strong class="text-text-primary">Consentimento:</strong> Para acesso ao HealthKit, serviços de localização e determinadas análises.</li>
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

applyI18n({ de, ja, pt })
