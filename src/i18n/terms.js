import { applyI18n } from './legal.js'

// Brazilian Portuguese translation of the Terms of Service. Structure and CSS
// classes mirror the English markup in terms.html exactly; only text changes.
// English remains the authoritative version (see the dated disclaimer line).

const pt = {
  __title: 'Termos de Serviço — StatsKey',
  'lp-title': 'Termos de Serviço',
  'lp-date':
    'Em vigor a partir de: 6 de setembro de 2026<span class="block mt-2 italic">Esta tradução para o português é apenas informativa. Em caso de divergência, prevalece a versão original em inglês.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Aceitação dos Termos</h2>
            <p>Ao baixar, instalar, acessar ou usar o StatsKey ("o Aplicativo"), você concorda em se vincular a estes Termos de Serviço ("Termos"). Se você não concordar com todos estes Termos, não deve usar o Aplicativo. Reservamo-nos o direito de modificar estes Termos a qualquer momento. O uso contínuo do Aplicativo após quaisquer alterações constitui aceitação dos Termos revisados.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Descrição do Serviço</h2>
            <p class="mb-3">O StatsKey é um aplicativo de acompanhamento de nutrição, fitness e dados biométricos que oferece:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Reconhecimento de alimentos por IA e estimativa nutricional a partir de fotos e texto</li>
              <li>Análise e acompanhamento nutricional de mais de 50 nutrientes</li>
              <li>Registro de exercícios, atividades e treinos</li>
              <li>Monitoramento de peso e medidas corporais</li>
              <li>Integração com monitor contínuo de glicose (CGM) e sincronização de registros históricos de glicose</li>
              <li>Integração com o Apple Health (iOS) e o Android Health Connect, incluindo a importação opcional de registros históricos que você autorizar</li>
              <li>Recursos conversacionais de IA para consultas de dados de saúde, incluindo consultas que usam registros históricos de glicose sincronizados</li>
              <li>Sincronização na nuvem</li>
            </ul>
            <p class="mt-3">Recursos podem ser adicionados, modificados, limitados, suspensos, renomeados, substituídos ou removidos a qualquer momento sem aviso prévio.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Contas de Usuário</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Você deve ter pelo menos 13 anos para usar o StatsKey.</li>
              <li>Você deve fornecer informações de conta precisas e completas.</li>
              <li>Você é o único responsável por manter a confidencialidade e a segurança das credenciais da sua conta.</li>
              <li>Uma conta por pessoa.</li>
              <li>Você deve nos notificar imediatamente sobre qualquer acesso ou uso não autorizado da sua conta.</li>
              <li>Você é responsável por toda atividade que ocorrer na sua conta.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Aviso Médico</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02] text-text-primary">
              <strong>IMPORTANTE — LEIA COM ATENÇÃO.</strong> O StatsKey NÃO é um dispositivo médico, NÃO se destina a diagnosticar, tratar, curar ou prevenir qualquer doença ou condição médica e NÃO substitui orientação médica profissional, diagnóstico, tratamento, monitoramento de glicose ou manejo do diabetes. Todas as informações nutricionais, exibições de dados de glicose, análises de tendência de glicose, correlações biométricas, insights de saúde, relatórios, alertas, resumos e resultados gerados por IA fornecidos pelo StatsKey são apenas estimativas e aproximações. Podem estar atrasados, imprecisos, incompletos, indisponíveis ou incorretos. Não use o StatsKey, registros de glicose sincronizados, alertas, resumos, resultados de IA, relatórios ou outro conteúdo do Aplicativo para tomar decisões de dosagem de insulina, decisões sobre medicamentos, decisões de tratamento de hipoglicemia ou hiperglicemia, decisões de emergência ou quaisquer outras decisões médicas. Use o dispositivo de CGM aplicável, o aplicativo ou receptor fornecido pelo fabricante, a rotulagem do produto, medições com glicosímetro quando apropriado e a orientação do seu profissional de saúde qualificado para decisões médicas. Nunca ignore orientação médica profissional nem atrase a busca por tratamento por causa de informações fornecidas pelo StatsKey. Você assume total responsabilidade pela forma como usa qualquer informação fornecida pelo Aplicativo. Se você tiver uma emergência médica, ligue imediatamente para os serviços de emergência locais.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Aviso sobre Conteúdo Gerado por IA</h2>
            <p>O StatsKey usa serviços de inteligência artificial de terceiros (incluindo, entre outros, Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok e outros provedores que possamos selecionar) para analisar fotos de alimentos, estimar conteúdo nutricional, gerar conteúdo de treino ou nutrição e gerar respostas conversacionais sobre seus dados de saúde. Se você ativar os recursos relevantes, as respostas conversacionais de IA podem usar registros históricos de saúde sincronizados, incluindo registros de glicose importados do Apple Health, de provedores de CGM ou de outras fontes e copiados para sua conta StatsKey usando o Firebase / Google Cloud Platform. O conteúdo gerado por IA é fornecido "no estado em que se encontra" (as-is). Não fazemos declarações nem garantias quanto à sua exatidão, integridade, confiabilidade, atualidade, segurança ou adequação a qualquer finalidade. Os resultados de IA podem conter erros, alucinações, omissões, informações desatualizadas ou enganosas. Você deve verificar de forma independente qualquer informação gerada por IA antes de confiar nela e não deve confiar em resultados de IA para decisões médicas, clínicas, de dosagem de insulina, de emergência, jurídicas, financeiras ou críticas para a segurança. Provedores de IA, modelos, prompts, roteamento, limites e disponibilidade podem mudar a qualquer momento sem aviso prévio.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Ausência de Garantia de Recursos, Roadmap ou Disponibilidade</h2>
            <p class="mb-3">O StatsKey é fornecido como um aplicativo em evolução. Não garantimos que qualquer recurso atual, anunciado, planejado, experimental, beta, de pré-visualização, de acesso antecipado ou futuro será lançado, continuará, funcionará para todos os usuários, funcionará em todos os dispositivos, funcionará em todas as regiões, permanecerá gratuito ou incluído em qualquer nível de assinatura, permanecerá materialmente igual ou atenderá às suas expectativas ou ao uso pretendido.</p>
            <p class="mb-3">Isso se aplica a todos os recursos e serviços do Aplicativo, incluindo, sem limitação, reconhecimento de alimentos por IA, leitura de código de barras ou rótulos, estimativas nutricionais, bancos de dados de nutrientes, metas, relatórios, painéis, chat do Intelligence, planos gerados, insights gerados, exibições de glicose, análise de tendência de glicose, conexões de CGM, Dexcom Share, API da Dexcom, Abbott LibreLinkUp, Nightscout, importação ou exportação do Apple Health e do Android Health Connect, sincronização de registros históricos de saúde, sincronização na nuvem, backups, exportação de dados, Amigos, feeds sociais, mensagens, compartilhamento, assinaturas, cobrança pela App Store, cobrança pelo Google Play, cobrança pela Stripe, registro de treinos, GPS, mapas de rota, clima, notificações, widgets, integrações, recursos da web, e qualquer roadmap, demonstração, captura de tela, declaração de suporte, alegação de marketing, texto da loja de apps, declaração em página de preços ou outra comunicação pública ou privada sobre o StatsKey.</p>
            <p class="mb-3">Exceto quando estes Termos expressamente disserem o contrário, declarações sobre recursos, prazos, desempenho, integrações, preços, compatibilidade, modelos, provedores, tempo de atividade (uptime), exatidão ou planos futuros são apenas informativas e não são compromissos vinculativos, garantias, acordos de nível de serviço (SLA) ou garantias. O acesso pago, se houver, é para o Aplicativo conforme disponibilizado durante o período de assinatura aplicável, e não para qualquer recurso, integração, provedor, fonte de dados, tipo de relatório, modelo de IA, resultado de IA, capacidade de sincronização, resultado clínico, resultado de negócio ou entrega futura específicos.</p>
            <p class="mb-3">Podemos suspender, limitar, medir, restringir (throttle), atrasar, recusar, remover, substituir, renomear, restringir por região, restringir por conta, restringir por dispositivo, cobrar separadamente por, ou descontinuar qualquer recurso ou serviço a qualquer momento, com ou sem aviso, por qualquer motivo, incluindo necessidades operacionais, manutenção, segurança, prevenção de abusos, proteção do usuário, questões legais ou regulatórias, revisão da App Store ou da plataforma, requisitos de terceiros, indisponibilidade de provedores, alterações de API, limites de taxa, permissões de conta, problemas de credenciais, problemas de sensor ou dispositivo, falhas na nuvem, alterações de provedores de IA, problemas de qualidade de dados, motivos de negócio ou nosso julgamento de que um recurso não deve ser oferecido.</p>
            <p>Você é responsável por manter qualquer dispositivo, sensor, conta, assinatura, sistema operacional, conexão de rede, permissões, credenciais, aplicativo de terceiros, aplicativo do fabricante, receptor e autorização de provedor necessários para que os recursos opcionais funcionem. Você não deve depender do StatsKey nem de qualquer recurso anunciado como sua única cópia de dados, única fonte de informações de saúde, único fluxo de trabalho para cuidados, único registro de cobrança, único canal de comunicação ou único meio de cumprir qualquer obrigação legal, médica, profissional, atlética, dietética ou de negócios.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Uso Aceitável</h2>
            <p class="mb-3"><strong class="text-text-primary">Você pode:</strong></p>
            <ul class="list-disc pl-5 space-y-1 mb-4">
              <li>Usar o StatsKey para acompanhamento pessoal de nutrição, fitness e saúde.</li>
              <li>Compartilhar seus próprios dados com profissionais de saúde.</li>
              <li>Exportar seus dados para uso pessoal.</li>
            </ul>
            <p class="mb-3"><strong class="text-text-primary">Você não pode:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Usar o Aplicativo para qualquer finalidade ilícita.</li>
              <li>Tentar fazer engenharia reversa, descompilar ou desmontar o Aplicativo.</li>
              <li>Compartilhar, vender ou distribuir dados de outros usuários.</li>
              <li>Usar sistemas automatizados, bots ou scripts para acessar o Aplicativo.</li>
              <li>Enviar conteúdo inadequado, ofensivo ou ilegal.</li>
              <li>Explorar nossa API ou tentar registrar dados além do que um ser humano poderia razoavelmente registrar em um único dia.</li>
              <li>Contornar quaisquer medidas de segurança ou controles de acesso.</li>
              <li>Usar o Aplicativo, as integrações de CGM ou quaisquer credenciais, tokens, sessões, APIs ou dados de terceiros de forma que viole os termos de terceiros aplicáveis, contratos de desenvolvedor, rotulagem de produto, aprovações regulatórias ou permissões de acesso.</li>
              <li>Usar qualquer integração de CGM para administração automatizada de insulina, monitoramento ativo de pacientes destinado a desencadear ação clínica imediata, monitoramento hospitalar ou de internação, resposta a emergências, ensaios clínicos, funcionalidade regulada de dispositivo médico ou qualquer outro uso que exija autorização regulatória ou de provedor que o StatsKey não tenha obtido expressamente.</li>
              <li>Usar o Aplicativo para desenvolver um produto ou serviço concorrente.</li>
            </ul>
            <p class="mt-3">Qualquer violação dessas restrições pode resultar no encerramento imediato da sua conta e na revogação da sua assinatura sem reembolso.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Assinatura e Pagamento</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>O StatsKey oferece um período de teste gratuito, após o qual é necessária uma assinatura paga.</li>
              <li>As assinaturas no app são cobradas pela App Store da Apple (iOS) ou pelo Google Play (Android) e estão sujeitas aos termos e condições da Apple ou do Google; as assinaturas adquiridas em nosso site são cobradas pela Stripe.</li>
              <li>Sua assinatura é renovada automaticamente, a menos que você a cancele com pelo menos 24 horas de antecedência do fim do período de cobrança atual.</li>
              <li>Seu único recurso em caso de insatisfação com o serviço é o cancelamento da assinatura.</li>
              <li>As taxas de assinatura não são reembolsáveis, exceto quando exigido pela legislação aplicável.</li>
              <li>Não garantimos que qualquer recurso estará sempre disponível, ininterrupto, exato, atual ou livre de erros.</li>
              <li>As taxas de assinatura não lhe dão direito a qualquer recurso, integração, provedor, modelo de IA, fonte de dados, relatório, capacidade de sincronização ou nível de tempo de atividade específico, atual ou futuro, exceto quando exigido pela legislação aplicável.</li>
              <li>Reservamo-nos o direito de alterar os preços com aviso prévio razoável.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Propriedade Intelectual</h2>
            <p class="mb-3" data-public-disclosure-commitment="true"><strong class="text-text-primary">Sem divulgação pública.</strong> O StatsKey e seu fundador não publicarão nem compartilharão publicamente de outra forma seus dados de localização ou informações de bem-estar, saúde ou condicionamento físico que identifiquem você ou que possam ser razoavelmente associadas a você. Isso inclui publicações públicas, publicidade, demonstrações e estudos de caso. Você pode continuar optando por compartilhar seus próprios dados de forma privada com pessoas que escolher. O tratamento necessário por prestadores de serviços e as divulgações exigidas por lei continuam sujeitos à nossa <a href="/privacy" class="text-accent hover:underline">Política de Privacidade</a>.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>O StatsKey, seu design, código, conteúdo, marcas registradas e todos os materiais originais são propriedade exclusiva do StatsKey e são protegidos por leis de direitos autorais, marcas registradas e outras leis de propriedade intelectual.</li>
              <li>Você mantém a titularidade dos seus dados pessoais.</li>
              <li>Ao usar o Aplicativo, você nos concede uma licença limitada, não exclusiva e mundial para processar, armazenar e transmitir seus dados unicamente para fornecer e melhorar o serviço.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Serviços de Localização</h2>
            <p class="mb-3">O StatsKey usa serviços de localização para aprimorar o registro de treinos. Ao ativar os serviços de localização:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Localização em segundo plano:</strong> Acessada apenas durante uma sessão de treino ativa para acompanhar rota, distância, ritmo e elevação. Cessa quando o treino termina ou é pausado.</li>
              <li><strong class="text-text-primary">Localização em primeiro plano:</strong> Acessada enquanto o app está em uso ativo, para exibição de mapa e precisão do registro de atividades.</li>
              <li>Os dados de localização são armazenados no seu dispositivo e, se a sincronização na nuvem estiver ativada, na sua conta criptografada.</li>
              <li>Não vendemos, compartilhamos nem monetizamos dados de localização com terceiros.</li>
              <li>Você pode desativar os serviços de localização a qualquer momento; no entanto, isso pode limitar a funcionalidade de registro de treinos.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Serviços de Terceiros</h2>
            <p class="mb-3">O StatsKey integra-se a serviços de terceiros, incluindo, entre outros:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Apple HealthKit (iOS) e Android Health Connect, incluindo a importação opcional de registros de saúde e de glicose (sujeito aos termos da Apple ou do Google)</li>
              <li>Login com a Apple e o Google (sujeito aos respectivos termos)</li>
              <li>Firebase / Google Cloud Platform (sujeito aos termos do Google)</li>
              <li>App Store da Apple e Google Play, incluindo a cobrança de assinaturas no app (sujeito aos respectivos termos)</li>
              <li>Provedores e serviços de CGM (incluindo os sistemas de CGM da Dexcom, Dexcom Share, Abbott LibreLinkUp e Nightscout — sujeitos aos respectivos termos, políticas de privacidade, rotulagem de produto e disponibilidade)</li>
              <li>Provedores de IA (incluindo Google, Anthropic, OpenAI, xAI e outros provedores que possamos selecionar — sujeitos aos respectivos termos)</li>
            </ul>
            <p class="mt-3">Não somos responsáveis pela disponibilidade, exatidão, segurança, legalidade, desempenho, continuidade, preços, limites de taxa, políticas ou práticas de qualquer serviço de terceiros. O uso de serviços de terceiros é por sua conta e risco e está sujeito aos termos dessas partes. Você é responsável por manter qualquer conta, dispositivo, sensor, receptor, aplicativo móvel, permissões, autorizações, conexão com a internet e configuração de produto de terceiros necessários para que esses serviços funcionem. Podemos desativar, limitar ou remover uma integração de terceiros se o provedor alterar o acesso, se opuser à integração, impuser limites, alterar os termos, sofrer uma interrupção, ou se determinarmos que manter a integração cria risco legal, de segurança, operacional, regulatório ou de negócio.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Integração de Dados Dexcom e CGM</h2>
            <p class="mb-3">O StatsKey pode permitir que você conecte dados de monitor contínuo de glicose de serviços de terceiros, incluindo os sistemas de CGM da Dexcom, Dexcom Share, Apple Health, Abbott LibreLinkUp e Nightscout. Essas integrações são opcionais e são ativadas somente quando você fornece as permissões, credenciais, URL ou outras informações de conexão necessárias.</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Autorização.</strong> Ao conectar um serviço de CGM, você declara que é titular da conta ou tem autoridade legal para conectá-la, e autoriza o StatsKey a recuperar, processar, exibir, armazenar e sincronizar leituras de glicose e metadados relacionados em seu nome.</li>
              <li><strong class="text-text-primary">Status de terceiro.</strong> O StatsKey não tem afiliação com, não é patrocinado, endossado, aprovado ou validado por, nem atua como agente de qualquer provedor de CGM, salvo se declararmos expressamente o contrário por escrito. Se um provedor exigir autorização separada, acesso de produção, revisão, certificação ou acordo, a integração relacionada estará disponível apenas na medida em que esse provedor permitir. Podemos limitar, suspender ou desativar a funcionalidade de CGM a qualquer momento se exigido ou recomendado por um provedor, plataforma, regulador, preocupação de segurança, obrigação legal ou nossa própria avaliação de risco.</li>
              <li><strong class="text-text-primary">Termos de terceiros.</strong> Você deve cumprir os termos de terceiros aplicáveis, as políticas de privacidade, a rotulagem do produto, as regras de conta e as configurações de compartilhamento. Não controlamos esses termos e não podemos garantir que um provedor terceiro continuará a permitir, dar suporte ou disponibilizar qualquer integração.</li>
              <li><strong class="text-text-primary">Revogação e desconexão.</strong> Você pode desconectar uma integração de CGM no Aplicativo, e alguns provedores também podem permitir que você revogue a autorização nas configurações da conta do próprio provedor. A desconexão ou revogação interrompe a sincronização futura quando tecnicamente possível, mas não exclui automaticamente os registros de glicose já importados para o StatsKey; esses registros permanecem sujeitos à nossa Política de Privacidade e aos seus direitos de exclusão.</li>
              <li><strong class="text-text-primary">Atraso e disponibilidade.</strong> Os dados de CGM no StatsKey podem estar atrasados, incompletos, duplicados, indisponíveis, simulados, desatualizados, transformados, rotulados incorretamente ou diferentes dos dados mostrados no próprio dispositivo, receptor ou aplicativo do fabricante. Os serviços do provedor podem ser interrompidos, limitados por taxa, alterados, suspensos ou encerrados sem aviso. Dados de CGM de sandbox ou simulados não devem ser usados para validação clínica, treinamento de algoritmos, uso em produção ou decisões médicas.</li>
              <li><strong class="text-text-primary">Sem uso médico ou crítico para a segurança.</strong> O StatsKey é um aplicativo de acompanhamento histórico, análise e bem-estar. Não é um monitor de glicose em tempo real, alarme, serviço de monitoramento remoto, sistema de notificação de emergência, ferramenta de tratamento de diabetes ou componente de administração automatizada de insulina. Não use o StatsKey para detectar, tratar ou responder a hipoglicemia ou hiperglicemia, para calcular ou administrar insulina, para ajustar medicamentos ou para tomar outras decisões médicas.</li>
              <li><strong class="text-text-primary">Sem uso indevido.</strong> Você não pode usar o StatsKey para contornar controles de acesso, extrair (scrape) ou sobrecarregar serviços de terceiros, interferir na integridade do serviço, acessar dados de CGM sem autorização, monitorar outra pessoa sem autoridade legal e consentimento, comparar ou avaliar (benchmark) produtos ou serviços de CGM, fazer declarações falsas ou enganosas sobre um provedor de CGM ou seus produtos, ou usar integrações de CGM para fins clínicos, comerciais, de emergência ou de dispositivo médico regulado.</li>
            </ul>
            <p>Dexcom e Dexcom Share são marcas registradas ou não registradas da Dexcom, Inc. nos Estados Unidos e/ou em outros países. Abbott, FreeStyle Libre e LibreLinkUp são marcas comerciais da Abbott e de suas afiliadas. Nightscout é um projeto de código aberto e não é operado pelo StatsKey.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Isenções de Responsabilidade</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              O APLICATIVO E TODO O CONTEÚDO, RECURSOS, INTEGRAÇÕES, RESULTADOS, DADOS, RELATÓRIOS, EXIBIÇÕES, ALERTAS, RESUMOS, RESPOSTAS DE IA E SERVIÇOS SÃO FORNECIDOS "NO ESTADO EM QUE SE ENCONTRAM" E "CONFORME DISPONÍVEIS", SEM GARANTIAS DE QUALQUER ESPÉCIE, SEJAM EXPRESSAS, IMPLÍCITAS, LEGAIS OU DE OUTRA NATUREZA. NA MÁXIMA EXTENSÃO PERMITIDA POR LEI, ISENTAMO-NOS DE TODAS AS GARANTIAS, INCLUINDO, ENTRE OUTRAS, AS GARANTIAS IMPLÍCITAS DE COMERCIABILIDADE, ADEQUAÇÃO A UMA FINALIDADE ESPECÍFICA, NÃO VIOLAÇÃO, TITULARIDADE, FRUIÇÃO PACÍFICA, DISPONIBILIDADE, PONTUALIDADE, COMPATIBILIDADE E EXATIDÃO. NÃO GARANTIMOS QUE O APLICATIVO SERÁ ININTERRUPTO, LIVRE DE ERROS, SEGURO, DISPONÍVEL, EXATO, COMPLETO, ATUAL OU LIVRE DE VÍRUS OU OUTROS COMPONENTES NOCIVOS. NÃO GARANTIMOS A EXATIDÃO, A INTEGRIDADE OU A CONFIABILIDADE DE QUAISQUER ESTIMATIVAS NUTRICIONAIS, CONTEÚDO GERADO POR IA, INSIGHTS DE SAÚDE, ANÁLISE DE GLICOSE, CORRELAÇÕES BIOMÉTRICAS, RELATÓRIOS, REGISTROS SINCRONIZADOS, DADOS DE TERCEIROS OU RESULTADOS DE RECURSOS. TODOS OS DADOS E RESULTADOS SÃO APROXIMAÇÕES E PODEM CONTER ERROS.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Limitação de Responsabilidade</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              NA MÁXIMA EXTENSÃO PERMITIDA PELA LEGISLAÇÃO APLICÁVEL, EM NENHUMA HIPÓTESE O STATSKEY, SEUS DIRETORES, CONSELHEIROS, FUNCIONÁRIOS, CONTRATADOS, AGENTES, PRESTADORES DE SERVIÇO OU AFILIADAS SERÃO RESPONSÁVEIS POR QUAISQUER DANOS INDIRETOS, INCIDENTAIS, ESPECIAIS, CONSEQUENCIAIS, PUNITIVOS, EXEMPLARES OU AGRAVADOS, INCLUINDO, ENTRE OUTROS, DANOS POR PERDA DE LUCROS, RECEITA, REPUTAÇÃO (GOODWILL), DADOS, USO, VALOR DA ASSINATURA, OPORTUNIDADE DE NEGÓCIO, RESULTADOS DE SAÚDE, LESÃO CORPORAL, SOFRIMENTO EMOCIONAL, DANO PESSOAL, FALHA DE DISPOSITIVO, ALERTAS PERDIDOS, FALHA DE SINCRONIZAÇÃO, PERDA DE REGISTROS, CONFIANÇA EM RESULTADOS DE IA, CONFIANÇA EM INFORMAÇÕES DE SAÚDE OU GLICOSE, FALHA NA ENTREGA DE UM RECURSO, ATRASO NA ENTREGA, REMOÇÃO DE UM RECURSO, FALHA DE SERVIÇO DE TERCEIROS OU OUTRAS PERDAS INTANGÍVEIS, DECORRENTES DE OU RELACIONADAS AO SEU USO OU À IMPOSSIBILIDADE DE USAR O APLICATIVO, INDEPENDENTEMENTE DA TEORIA DE RESPONSABILIDADE (CONTRATUAL, EXTRACONTRATUAL, NEGLIGÊNCIA, RESPONSABILIDADE OBJETIVA, RESPONSABILIDADE PELO PRODUTO, GARANTIA, LEI OU OUTRA), MESMO QUE TENHAMOS SIDO AVISADOS DA POSSIBILIDADE DE TAIS DANOS. NOSSA RESPONSABILIDADE TOTAL AGREGADA POR TODAS AS RECLAMAÇÕES DECORRENTES DE OU RELACIONADAS AO APLICATIVO NÃO EXCEDERÁ O MAIOR ENTRE (A) O VALOR QUE VOCÊ NOS PAGOU NOS DOZE (12) MESES ANTERIORES À RECLAMAÇÃO, OU (B) CEM DÓLARES (US$ 100).
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Indenização</h2>
            <p>Você concorda em indenizar, defender e isentar de responsabilidade o StatsKey, seus diretores, conselheiros, funcionários, contratados, agentes, prestadores de serviço e afiliadas de e contra toda e qualquer reclamação, responsabilidade, dano, perda, custo e despesa (incluindo honorários advocatícios razoáveis) decorrentes de ou de qualquer forma relacionados a: (a) seu uso ou confiança no Aplicativo; (b) sua violação destes Termos; (c) sua violação de quaisquer direitos de terceiros; (d) sua violação de quaisquer termos de terceiros, rotulagem de produto, regras de provedor ou legislação aplicável; (e) seu uso de qualquer recurso de saúde, glicose, IA, sincronização, social, cobrança ou integração; ou (f) qualquer reclamação de que seu uso do Aplicativo causou dano a um terceiro.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Resolução de Disputas e Arbitragem</h2>
            <p class="mb-3"><strong class="text-text-primary">Arbitragem Vinculante.</strong> Qualquer disputa, reclamação ou controvérsia decorrente de ou relacionada a estes Termos ou ao Aplicativo será resolvida por arbitragem vinculante administrada pela American Arbitration Association ("AAA") de acordo com suas Consumer Arbitration Rules, em vez de em tribunal, exceto que qualquer das partes pode buscar medida liminar ou de natureza cautelar em tribunal para questões de propriedade intelectual.</p>
            <p class="mb-3"><strong class="text-text-primary">Renúncia a Ações Coletivas.</strong> VOCÊ E O STATSKEY CONCORDAM QUE CADA UM PODERÁ APRESENTAR RECLAMAÇÕES CONTRA O OUTRO APENAS EM SUA CAPACIDADE INDIVIDUAL E NÃO COMO AUTOR OU MEMBRO DE UMA CLASSE EM QUALQUER SUPOSTA AÇÃO COLETIVA, CONSOLIDADA OU REPRESENTATIVA. O árbitro não poderá consolidar as reclamações de mais de uma pessoa nem presidir qualquer forma de processo representativo ou coletivo.</p>
            <p><strong class="text-text-primary">Exclusão (Opt-Out).</strong> Você pode optar por sair deste acordo de arbitragem enviando notificação por escrito para ryanws@statskeybiometrics.com dentro de 30 dias após aceitar estes Termos pela primeira vez. Se você optar por sair, as disputas serão resolvidas nos tribunais especificados na Seção 18.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Encerramento da Conta</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Você pode excluir sua conta a qualquer momento pelo Aplicativo.</li>
              <li>Podemos suspender ou encerrar sua conta a qualquer momento por violação destes Termos, ou por qualquer outro motivo a nosso exclusivo critério, com ou sem aviso.</li>
              <li>Podemos suspender o serviço para manutenção, atualizações ou outros motivos operacionais.</li>
              <li>Com o encerramento, seu direito de usar o Aplicativo cessa imediatamente.</li>
              <li>Os dados excluídos não podem ser recuperados. Não somos responsáveis pela perda de dados resultante da exclusão da conta.</li>
              <li>As Seções 4, 5, 6, 11, 12, 13, 14, 15, 16 e 18 permanecem em vigor após o encerramento.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">18. Lei Aplicável e Jurisdição</h2>
            <p>Estes Termos serão regidos e interpretados de acordo com as leis do Estado do Texas, Estados Unidos, sem considerar suas disposições sobre conflito de leis. Sujeito à disposição de arbitragem acima, qualquer ação judicial decorrente destes Termos será proposta exclusivamente nos tribunais estaduais ou federais localizados no Texas, e você consente com a jurisdição pessoal de tais tribunais.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">19. Força Maior</h2>
            <p>Não seremos responsáveis por qualquer falha, atraso, suspensão, perda de dados, desempenho degradado, não entrega ou descontinuação resultante de causas além do nosso controle razoável, incluindo, entre outros, casos fortuitos ou de força maior, desastres naturais, guerra, terrorismo, pandemias, disputas trabalhistas, ações governamentais, ação regulatória, ação da App Store, do Google Play ou da plataforma, falhas de energia, falhas de internet ou telecomunicações, indisponibilidade de provedores de nuvem, indisponibilidade de processadores de pagamento, indisponibilidade de provedores de IA, alterações de API de terceiros, alterações de provedores de CGM, limites de taxa, incidentes de segurança ou interrupções de serviços de terceiros.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">20. Independência das Cláusulas</h2>
            <p>Se qualquer disposição destes Termos for considerada inválida, ilegal ou inexequível, as demais disposições continuarão em pleno vigor e efeito. A disposição inválida será modificada na medida mínima necessária para torná-la válida e exequível, preservando sua intenção original.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">21. Acordo Integral</h2>
            <p>Estes Termos, juntamente com a Política de Privacidade e quaisquer termos de compra apresentados pela Apple, Stripe ou outro provedor de pagamento, constituem o acordo integral entre você e o StatsKey quanto ao seu uso do Aplicativo e substituem todos os acordos, entendimentos, promessas, declarações e representações anteriores, incluindo quaisquer declarações sobre recursos, itens de roadmap, prazos, preços, integrações ou entregas futuras.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">22. Contato</h2>
            <p>Para dúvidas sobre estes Termos:</p>
            <p class="mt-2"><strong class="text-text-primary">E-mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">Ao usar o StatsKey, você reconhece que leu, entendeu e concorda em se vincular a estes Termos de Serviço e à nossa <a href="/privacy" class="text-accent hover:underline">Política de Privacidade</a>.</p>
          </section>
  `,
}

const es = {
  __title: 'Términos del Servicio — StatsKey',
  'lp-title': 'Términos del Servicio',
  'lp-date':
    'Fecha de entrada en vigor: 6 de septiembre de 2026<span class="block mt-2 italic">Esta traducción al español tiene únicamente fines informativos. En caso de discrepancia, prevalece la versión original en inglés.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Aceptación de los Términos</h2>
            <p>Al descargar, instalar, acceder o usar StatsKey («la Aplicación»), aceptas quedar obligado por estos Términos del Servicio («Términos»). Si no aceptas todos estos Términos, no debes usar la Aplicación. Nos reservamos el derecho de modificar estos Términos en cualquier momento. El uso continuado de la Aplicación tras cualquier cambio constituye la aceptación de los Términos revisados.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Descripción del servicio</h2>
            <p class="mb-3">StatsKey es una aplicación de seguimiento de nutrición, fitness y datos biométricos que ofrece:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Reconocimiento de alimentos con IA y estimación nutricional a partir de fotos y texto</li>
              <li>Análisis y seguimiento nutricional de más de 50 nutrientes</li>
              <li>Registro de ejercicio, actividad y entrenamientos</li>
              <li>Monitorización del peso y de las medidas corporales</li>
              <li>Integración con monitor continuo de glucosa (MCG) y sincronización de registros históricos de glucosa</li>
              <li>Integración con Apple Health (iOS) y Android Health Connect, incluida la importación opcional de registros históricos que autorices</li>
              <li>Funciones conversacionales de IA para consultas sobre datos de salud, incluidas consultas que usan registros históricos de glucosa sincronizados</li>
              <li>Sincronización en la nube</li>
            </ul>
            <p class="mt-3">Las funciones pueden añadirse, modificarse, limitarse, suspenderse, renombrarse, sustituirse o eliminarse en cualquier momento sin previo aviso.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Cuentas de usuario</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Debes tener al menos 13 años para usar StatsKey.</li>
              <li>Debes proporcionar información de cuenta precisa y completa.</li>
              <li>Eres el único responsable de mantener la confidencialidad y la seguridad de las credenciales de tu cuenta.</li>
              <li>Una cuenta por persona.</li>
              <li>Debes notificarnos de inmediato cualquier acceso o uso no autorizado de tu cuenta.</li>
              <li>Eres responsable de toda la actividad que ocurra en tu cuenta.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Aviso médico</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02] text-text-primary">
              <strong>IMPORTANTE — LEE CON ATENCIÓN.</strong> StatsKey NO es un dispositivo médico, NO está destinado a diagnosticar, tratar, curar ni prevenir ninguna enfermedad o afección médica, y NO sustituye el consejo médico profesional, el diagnóstico, el tratamiento, la monitorización de glucosa ni el manejo de la diabetes. Toda la información nutricional, las visualizaciones de datos de glucosa, el análisis de tendencias de glucosa, las correlaciones biométricas, las conclusiones de salud, los informes, las alertas, los resúmenes y los resultados generados por IA que proporciona StatsKey son únicamente estimaciones y aproximaciones. Pueden estar retrasados, ser inexactos, incompletos, no estar disponibles o ser incorrectos. No uses StatsKey, los registros de glucosa sincronizados, las alertas, los resúmenes, los resultados de IA, los informes ni ningún otro contenido de la Aplicación para tomar decisiones de dosificación de insulina, decisiones sobre medicación, decisiones de tratamiento de hipoglucemia o hiperglucemia, decisiones de emergencia ni ninguna otra decisión médica. Utiliza el dispositivo de MCG correspondiente, la aplicación o el receptor proporcionados por el fabricante, el etiquetado del producto, las comprobaciones con glucómetro cuando proceda y el consejo de tu profesional sanitario cualificado para las decisiones médicas. Nunca ignores el consejo médico profesional ni retrases la búsqueda de tratamiento por causa de la información proporcionada por StatsKey. Asumes toda la responsabilidad por el uso que hagas de cualquier información proporcionada por la Aplicación. Si sufres una emergencia médica, llama de inmediato a los servicios de emergencia locales.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Aviso sobre contenido generado por IA</h2>
            <p>StatsKey utiliza servicios de inteligencia artificial de terceros (incluidos, entre otros, Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok y otros proveedores que podamos seleccionar) para analizar fotos de alimentos, estimar el contenido nutricional, generar contenido de entrenamiento o nutrición y generar respuestas conversacionales sobre tus datos de salud. Si activas las funciones correspondientes, las respuestas conversacionales de IA pueden usar registros históricos de salud sincronizados, incluidos registros de glucosa importados de Apple Health, de proveedores de MCG o de otras fuentes y respaldados en tu cuenta de StatsKey mediante Firebase / Google Cloud Platform. El contenido generado por IA se proporciona «tal cual». No formulamos declaraciones ni garantías sobre su exactitud, integridad, fiabilidad, vigencia, seguridad o idoneidad para ningún fin. Los resultados de IA pueden contener errores, alucinaciones, omisiones, información desactualizada o engañosa. Debes verificar de forma independiente cualquier información generada por IA antes de confiar en ella, y no debes basarte en los resultados de IA para decisiones médicas, clínicas, de dosificación de insulina, de emergencia, legales, financieras o críticas para la seguridad. Los proveedores de IA, los modelos, las indicaciones, el enrutamiento, los límites y la disponibilidad pueden cambiar en cualquier momento sin previo aviso.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Sin garantía de funciones, hoja de ruta ni disponibilidad</h2>
            <p class="mb-3">StatsKey se ofrece como una aplicación en evolución. No garantizamos que ninguna función actual, anunciada, planificada, experimental, beta, de vista previa, de acceso anticipado o futura vaya a lanzarse, continuar, funcionar para todos los usuarios, funcionar en todos los dispositivos, funcionar en todas las regiones, seguir siendo gratuita o incluida en cualquier nivel de suscripción, permanecer sustancialmente igual o satisfacer tus expectativas o el uso previsto.</p>
            <p class="mb-3">Esto se aplica a todas las funciones y servicios de la Aplicación, incluidos, entre otros, el reconocimiento de alimentos con IA, el escaneo de códigos de barras o etiquetas, las estimaciones nutricionales, las bases de datos de nutrientes, los objetivos, los informes, los paneles, el chat de Intelligence, los planes generados, las conclusiones generadas, las visualizaciones de glucosa, el análisis de tendencias de glucosa, las conexiones de MCG, Dexcom Share, la API de Dexcom, Abbott LibreLinkUp, Nightscout, la importación o exportación de Apple Health y Android Health Connect, la sincronización de registros históricos de salud, la sincronización en la nube, las copias de seguridad, la exportación de datos, Amigos, los feeds sociales, la mensajería, el uso compartido, las suscripciones, la facturación por la App Store, la facturación por Google Play, la facturación por Stripe, el registro de entrenamientos, el GPS, los mapas de ruta, el tiempo meteorológico, las notificaciones, los widgets, las integraciones, las funciones web, y cualquier hoja de ruta, demostración, captura de pantalla, declaración de soporte, afirmación de marketing, texto de la tienda de apps, declaración en una página de precios u otra comunicación pública o privada sobre StatsKey.</p>
            <p class="mb-3">Salvo que estos Términos digan expresamente lo contrario, las declaraciones sobre funciones, plazos, rendimiento, integraciones, precios, compatibilidad, modelos, proveedores, tiempo de actividad, exactitud o planes futuros son meramente informativas y no constituyen compromisos vinculantes, garantías, acuerdos de nivel de servicio ni garantías. El acceso de pago, si lo hubiera, es para la Aplicación tal y como se ofrece durante el período de suscripción aplicable, y no para ninguna función, integración, proveedor, fuente de datos, tipo de informe, modelo de IA, resultado de IA, capacidad de sincronización, resultado clínico, resultado comercial o entregable futuro concretos.</p>
            <p class="mb-3">Podemos suspender, limitar, medir, restringir, retrasar, rechazar, eliminar, sustituir, renombrar, restringir por región, restringir por cuenta, restringir por dispositivo, cobrar por separado o discontinuar cualquier función o servicio en cualquier momento, con o sin aviso, por cualquier motivo, incluidas necesidades operativas, mantenimiento, seguridad, prevención de abusos, protección, cuestiones legales o regulatorias, revisión de la App Store o de la plataforma, requisitos de terceros, caídas de proveedores, cambios de API, límites de frecuencia, permisos de cuenta, problemas de credenciales, problemas de sensor o dispositivo, fallos en la nube, cambios de proveedores de IA, problemas de calidad de datos, motivos comerciales o nuestro criterio de que una función no debería ofrecerse.</p>
            <p>Eres responsable de mantener cualquier dispositivo, sensor, cuenta, suscripción, sistema operativo, conexión de red, permisos, credenciales, app de terceros, app del fabricante, receptor y autorización de proveedor necesarios para que las funciones opcionales funcionen. No debes basarte en StatsKey ni en ninguna función anunciada como tu única copia de datos, tu única fuente de información de salud, tu único flujo de trabajo para la atención, tu único registro de facturación, tu único canal de comunicación o tu único medio para cumplir cualquier obligación legal, médica, profesional, deportiva, dietética o comercial.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Uso aceptable</h2>
            <p class="mb-3"><strong class="text-text-primary">Puedes:</strong></p>
            <ul class="list-disc pl-5 space-y-1 mb-4">
              <li>Usar StatsKey para el seguimiento personal de nutrición, fitness y salud.</li>
              <li>Compartir tus propios datos con profesionales sanitarios.</li>
              <li>Exportar tus datos para uso personal.</li>
            </ul>
            <p class="mb-3"><strong class="text-text-primary">No puedes:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Usar la Aplicación con cualquier fin ilícito.</li>
              <li>Intentar realizar ingeniería inversa, descompilar o desensamblar la Aplicación.</li>
              <li>Compartir, vender o distribuir datos de otros usuarios.</li>
              <li>Usar sistemas automatizados, bots o scripts para acceder a la Aplicación.</li>
              <li>Subir contenido inadecuado, ofensivo o ilegal.</li>
              <li>Explotar nuestra API o intentar registrar datos en exceso de lo que una persona podría registrar razonablemente en un solo día.</li>
              <li>Eludir cualquier medida de seguridad o control de acceso.</li>
              <li>Usar la Aplicación, las integraciones de MCG o cualquier credencial, token, sesión, API o dato de terceros de un modo que infrinja los términos de terceros aplicables, los acuerdos de desarrollador, el etiquetado del producto, las aprobaciones regulatorias o los permisos de acceso.</li>
              <li>Usar cualquier integración de MCG para la administración automatizada de insulina, la monitorización activa de pacientes destinada a impulsar una acción clínica inmediata, la monitorización hospitalaria o de pacientes ingresados, la respuesta a emergencias, los ensayos clínicos, la funcionalidad regulada de dispositivo médico o cualquier otro uso que requiera una autorización regulatoria o de proveedor que StatsKey no haya obtenido expresamente.</li>
              <li>Usar la Aplicación para desarrollar un producto o servicio competidor.</li>
            </ul>
            <p class="mt-3">Cualquier infracción de estas restricciones puede dar lugar a la cancelación inmediata de tu cuenta y a la revocación de tu suscripción sin reembolso.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Suscripción y pago</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKey ofrece un período de prueba gratuito, tras el cual se requiere una suscripción de pago.</li>
              <li>Las suscripciones dentro de la app se facturan a través de la App Store de Apple (iOS) o de Google Play (Android) y están sujetas a los términos y condiciones de Apple o de Google; las suscripciones adquiridas en nuestro sitio web se facturan a través de Stripe.</li>
              <li>Tu suscripción se renueva automáticamente a menos que la canceles al menos 24 horas antes del final del período de facturación en curso.</li>
              <li>Tu único recurso en caso de insatisfacción con el servicio es la cancelación de tu suscripción.</li>
              <li>Las cuotas de suscripción no son reembolsables, salvo cuando lo exija la legislación aplicable.</li>
              <li>No garantizamos que ninguna función esté siempre disponible, sea ininterrumpida, exacta, puntual o esté libre de errores.</li>
              <li>Las cuotas de suscripción no te dan derecho a ninguna función, integración, proveedor, modelo de IA, fuente de datos, informe, capacidad de sincronización o nivel de tiempo de actividad concretos, actuales o futuros, salvo cuando lo exija la legislación aplicable.</li>
              <li>Nos reservamos el derecho de cambiar los precios con un aviso razonable.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Propiedad intelectual</h2>
            <p class="mb-3" data-public-disclosure-commitment="true"><strong class="text-text-primary">Sin divulgación pública.</strong> StatsKey y su fundador no publicarán ni compartirán públicamente de otro modo tus datos de ubicación ni información de bienestar, salud o actividad física que te identifique o que pueda vincularse razonablemente contigo. Esto incluye publicaciones públicas, publicidad, demostraciones y estudios de casos. Puedes seguir eligiendo compartir tus propios datos de forma privada con las personas que selecciones. El tratamiento necesario por parte de proveedores de servicios y las divulgaciones exigidas por la ley siguen sujetos a nuestra <a href="/privacy" class="text-accent hover:underline">Política de Privacidad</a>.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKey, su diseño, código, contenido, marcas comerciales y todos los materiales originales son propiedad exclusiva de StatsKey y están protegidos por las leyes de derechos de autor, marcas y otras leyes de propiedad intelectual.</li>
              <li>Conservas la titularidad de tus datos personales.</li>
              <li>Al usar la Aplicación, nos concedes una licencia limitada, no exclusiva y mundial para procesar, almacenar y transmitir tus datos únicamente para prestar y mejorar el servicio.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Servicios de ubicación</h2>
            <p class="mb-3">StatsKey utiliza los servicios de ubicación para mejorar el registro de entrenamientos. Al activar los servicios de ubicación:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Ubicación en segundo plano:</strong> Se accede únicamente durante una sesión de entrenamiento activa para seguir la ruta, la distancia, el ritmo y el desnivel. Cesa cuando el entrenamiento finaliza o se pausa.</li>
              <li><strong class="text-text-primary">Ubicación en primer plano:</strong> Se accede mientras la app está en uso activo para mostrar el mapa y mejorar la precisión del registro de la actividad.</li>
              <li>Los datos de ubicación se almacenan en tu dispositivo y, si la sincronización en la nube está activada, en tu cuenta cifrada.</li>
              <li>No vendemos, compartimos ni monetizamos los datos de ubicación con terceros.</li>
              <li>Puedes desactivar los servicios de ubicación en cualquier momento; no obstante, esto puede limitar la funcionalidad de registro de entrenamientos.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Servicios de terceros</h2>
            <p class="mb-3">StatsKey se integra con servicios de terceros, incluidos, entre otros:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Apple HealthKit (iOS) y Android Health Connect, incluida la importación opcional de registros de salud y de glucosa (sujeto a los términos de Apple o de Google)</li>
              <li>Inicio de sesión con Apple y con Google (sujeto a sus respectivos términos)</li>
              <li>Firebase / Google Cloud Platform (sujeto a los términos de Google)</li>
              <li>App Store de Apple y Google Play, incluida la facturación de suscripciones dentro de la app (sujeto a sus respectivos términos)</li>
              <li>Proveedores y servicios de MCG (incluidos los sistemas de MCG de Dexcom, Dexcom Share, Abbott LibreLinkUp y Nightscout, sujetos a sus respectivos términos, políticas de privacidad, etiquetado del producto y disponibilidad)</li>
              <li>Proveedores de IA (incluidos Google, Anthropic, OpenAI, xAI y otros proveedores que podamos seleccionar, sujetos a sus respectivos términos)</li>
            </ul>
            <p class="mt-3">No somos responsables de la disponibilidad, exactitud, seguridad, legalidad, rendimiento, continuidad, precios, límites de frecuencia, políticas o prácticas de ningún servicio de terceros. El uso de servicios de terceros es bajo tu propio riesgo y está sujeto a los términos de dichas partes. Eres responsable de mantener cualquier cuenta, dispositivo, sensor, receptor, app móvil, permisos, autorizaciones, conexión a internet y configuración de producto de terceros necesarios para que esos servicios funcionen. Podemos desactivar, limitar o eliminar una integración de terceros si el proveedor cambia el acceso, se opone a la integración, impone límites, cambia los términos, sufre una interrupción, o si determinamos que mantener la integración crea un riesgo legal, de seguridad, operativo, regulatorio o comercial.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Integración de datos de Dexcom y MCG</h2>
            <p class="mb-3">StatsKey puede permitirte conectar datos de monitor continuo de glucosa de servicios de terceros, incluidos los sistemas de MCG de Dexcom, Dexcom Share, Apple Health, Abbott LibreLinkUp y Nightscout. Estas integraciones son opcionales y solo se activan cuando proporcionas los permisos, las credenciales, la URL u otra información de conexión necesarios.</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Autorización.</strong> Al conectar un servicio de MCG, declaras que eres titular de la cuenta o que tienes autoridad legal para conectarla, y autorizas a StatsKey a recuperar, procesar, mostrar, almacenar y sincronizar lecturas de glucosa y metadatos relacionados en tu nombre.</li>
              <li><strong class="text-text-primary">Condición de tercero.</strong> StatsKey no está afiliado a, ni patrocinado, respaldado, aprobado o validado por, ni actúa como agente de ningún proveedor de MCG, salvo que lo declaremos expresamente por escrito. Si un proveedor exige una autorización separada, acceso de producción, revisión, certificación o acuerdo, la integración correspondiente estará disponible solo en la medida en que dicho proveedor lo permita. Podemos limitar, suspender o desactivar la funcionalidad de MCG en cualquier momento si así lo exige o recomienda un proveedor, una plataforma, un regulador, una preocupación de seguridad, una obligación legal o nuestra propia evaluación de riesgos.</li>
              <li><strong class="text-text-primary">Términos de terceros.</strong> Debes cumplir los términos de terceros aplicables, las políticas de privacidad, el etiquetado del producto, las normas de la cuenta y la configuración de uso compartido. No controlamos esos términos y no podemos garantizar que un proveedor externo siga permitiendo, admitiendo o poniendo a disposición cualquier integración.</li>
              <li><strong class="text-text-primary">Revocación y desconexión.</strong> Puedes desconectar una integración de MCG en la Aplicación, y algunos proveedores también pueden permitirte revocar la autorización en la configuración de la cuenta del propio proveedor. La desconexión o revocación detiene la sincronización futura cuando es técnicamente posible, pero no elimina automáticamente los registros de glucosa ya importados en StatsKey; esos registros siguen sujetos a nuestra Política de Privacidad y a tus derechos de eliminación.</li>
              <li><strong class="text-text-primary">Retraso y disponibilidad.</strong> Los datos de MCG en StatsKey pueden estar retrasados, incompletos, duplicados, no disponibles, simulados, desactualizados, transformados, mal etiquetados o ser distintos de los datos que muestra el propio dispositivo, receptor o aplicación del fabricante. Los servicios del proveedor pueden interrumpirse, limitarse en frecuencia, cambiarse, suspenderse o cancelarse sin previo aviso. Los datos de MCG de prueba (sandbox) o simulados no deben usarse para validación clínica, entrenamiento de algoritmos, uso en producción ni decisiones médicas.</li>
              <li><strong class="text-text-primary">Sin uso médico ni crítico para la seguridad.</strong> StatsKey es una aplicación de seguimiento histórico, análisis y bienestar. No es un monitor de glucosa en tiempo real, una alarma, un servicio de monitorización remota, un sistema de notificación de emergencias, una herramienta de tratamiento de la diabetes ni un componente de administración automatizada de insulina. No uses StatsKey para detectar, tratar o responder a la hipoglucemia o la hiperglucemia, para calcular o administrar insulina, para ajustar la medicación ni para tomar otras decisiones médicas.</li>
              <li><strong class="text-text-primary">Sin uso indebido.</strong> No puedes usar StatsKey para eludir controles de acceso, extraer (scraping) o sobrecargar servicios de terceros, interferir en la integridad del servicio, acceder a datos de MCG sin autorización, monitorizar a otra persona sin autoridad legal y consentimiento, comparar o evaluar (benchmark) productos o servicios de MCG, hacer afirmaciones falsas o engañosas sobre un proveedor de MCG o sus productos, o usar integraciones de MCG con fines clínicos, comerciales, de emergencia o de dispositivo médico regulado.</li>
            </ul>
            <p>Dexcom y Dexcom Share son marcas registradas o no registradas de Dexcom, Inc. en los Estados Unidos u otros países. Abbott, FreeStyle Libre y LibreLinkUp son marcas comerciales de Abbott y sus filiales. Nightscout es un proyecto de código abierto y no está operado por StatsKey.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Renuncias de responsabilidad</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              LA APLICACIÓN Y TODO EL CONTENIDO, FUNCIONES, INTEGRACIONES, RESULTADOS, DATOS, INFORMES, VISUALIZACIONES, ALERTAS, RESÚMENES, RESPUESTAS DE IA Y SERVICIOS SE PROPORCIONAN «TAL CUAL» Y «SEGÚN DISPONIBILIDAD», SIN GARANTÍAS DE NINGÚN TIPO, YA SEAN EXPRESAS, IMPLÍCITAS, LEGALES O DE OTRA ÍNDOLE. EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, RENUNCIAMOS A TODAS LAS GARANTÍAS, INCLUIDAS, ENTRE OTRAS, LAS GARANTÍAS IMPLÍCITAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN DETERMINADO, NO INFRACCIÓN, TITULARIDAD, GOCE PACÍFICO, DISPONIBILIDAD, PUNTUALIDAD, COMPATIBILIDAD Y EXACTITUD. NO GARANTIZAMOS QUE LA APLICACIÓN SEA ININTERRUMPIDA, ESTÉ LIBRE DE ERRORES, SEA SEGURA, ESTÉ DISPONIBLE, SEA EXACTA, COMPLETA, ACTUAL O ESTÉ LIBRE DE VIRUS U OTROS COMPONENTES DAÑINOS. NO GARANTIZAMOS LA EXACTITUD, INTEGRIDAD O FIABILIDAD DE NINGUNA ESTIMACIÓN NUTRICIONAL, CONTENIDO GENERADO POR IA, CONCLUSIÓN DE SALUD, ANÁLISIS DE GLUCOSA, CORRELACIÓN BIOMÉTRICA, INFORME, REGISTRO SINCRONIZADO, DATO DE TERCEROS O RESULTADO DE FUNCIÓN. TODOS LOS DATOS Y RESULTADOS SON APROXIMACIONES Y PUEDEN CONTENER ERRORES.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Limitación de responsabilidad</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEGISLACIÓN APLICABLE, EN NINGÚN CASO STATSKEY, SUS DIRECTIVOS, CONSEJEROS, EMPLEADOS, CONTRATISTAS, AGENTES, PROVEEDORES DE SERVICIOS O FILIALES SERÁN RESPONSABLES DE NINGÚN DAÑO INDIRECTO, INCIDENTAL, ESPECIAL, CONSECUENTE, PUNITIVO, EJEMPLAR O AGRAVADO, INCLUIDOS, ENTRE OTROS, LOS DAÑOS POR LUCRO CESANTE, PÉRDIDA DE INGRESOS, FONDO DE COMERCIO, DATOS, USO, VALOR DE LA SUSCRIPCIÓN, OPORTUNIDAD DE NEGOCIO, RESULTADOS DE SALUD, LESIONES CORPORALES, ANGUSTIA EMOCIONAL, DAÑO PERSONAL, FALLO DEL DISPOSITIVO, ALERTAS PERDIDAS, SINCRONIZACIÓN PERDIDA, REGISTROS PERDIDOS, CONFIANZA EN LOS RESULTADOS DE IA, CONFIANZA EN INFORMACIÓN DE SALUD O GLUCOSA, INCUMPLIMIENTO EN LA ENTREGA DE UNA FUNCIÓN, ENTREGA RETRASADA, ELIMINACIÓN DE UNA FUNCIÓN, FALLO DE UN SERVICIO DE TERCEROS U OTRAS PÉRDIDAS INTANGIBLES, DERIVADOS DE O RELACIONADOS CON TU USO O IMPOSIBILIDAD DE USO DE LA APLICACIÓN, CON INDEPENDENCIA DE LA TEORÍA DE RESPONSABILIDAD (CONTRATO, AGRAVIO, NEGLIGENCIA, RESPONSABILIDAD OBJETIVA, RESPONSABILIDAD POR PRODUCTO, GARANTÍA, LEY U OTRA), INCLUSO SI SE NOS HA ADVERTIDO DE LA POSIBILIDAD DE TALES DAÑOS. NUESTRA RESPONSABILIDAD TOTAL AGREGADA POR TODAS LAS RECLAMACIONES DERIVADAS DE O RELACIONADAS CON LA APLICACIÓN NO EXCEDERÁ LA MAYOR DE (A) LA CANTIDAD QUE NOS HAYAS PAGADO EN LOS DOCE (12) MESES ANTERIORES A LA RECLAMACIÓN, O (B) CIEN DÓLARES (100 USD).
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Indemnización</h2>
            <p>Aceptas indemnizar, defender y eximir de responsabilidad a StatsKey, sus directivos, consejeros, empleados, contratistas, agentes, proveedores de servicios y filiales, frente a todas y cada una de las reclamaciones, responsabilidades, daños, pérdidas, costes y gastos (incluidos los honorarios razonables de abogados) que surjan de o estén relacionados de cualquier modo con: (a) tu uso o tu confianza en la Aplicación; (b) tu incumplimiento de estos Términos; (c) tu vulneración de cualquier derecho de un tercero; (d) tu incumplimiento de cualquier término de terceros, etiquetado de producto, norma de proveedor o legislación aplicable; (e) tu uso de cualquier función de salud, glucosa, IA, sincronización, social, facturación o integración; o (f) cualquier reclamación de que tu uso de la Aplicación causó daño a un tercero.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Resolución de disputas y arbitraje</h2>
            <p class="mb-3"><strong class="text-text-primary">Arbitraje vinculante.</strong> Cualquier disputa, reclamación o controversia que surja de o esté relacionada con estos Términos o con la Aplicación se resolverá mediante arbitraje vinculante administrado por la American Arbitration Association («AAA») conforme a sus Consumer Arbitration Rules, en lugar de en los tribunales, salvo que cualquiera de las partes podrá solicitar medidas cautelares o equitativas ante los tribunales en asuntos de propiedad intelectual.</p>
            <p class="mb-3"><strong class="text-text-primary">Renuncia a acciones colectivas.</strong> TÚ Y STATSKEY ACEPTÁIS QUE CADA UNO PODRÁ PRESENTAR RECLAMACIONES CONTRA EL OTRO ÚNICAMENTE A TÍTULO INDIVIDUAL Y NO COMO DEMANDANTE O MIEMBRO DE UNA CLASE EN CUALQUIER SUPUESTA ACCIÓN COLECTIVA, CONSOLIDADA O REPRESENTATIVA. El árbitro no podrá acumular las reclamaciones de más de una persona ni presidir ninguna forma de procedimiento representativo o colectivo.</p>
            <p><strong class="text-text-primary">Exclusión (opt-out).</strong> Puedes excluirte de este acuerdo de arbitraje enviando una notificación por escrito a ryanws@statskeybiometrics.com en un plazo de 30 días desde que aceptaste por primera vez estos Términos. Si te excluyes, las disputas se resolverán en los tribunales especificados en la Sección 18.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Cancelación de la cuenta</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Puedes eliminar tu cuenta en cualquier momento a través de la Aplicación.</li>
              <li>Podemos suspender o cancelar tu cuenta en cualquier momento por incumplimiento de estos Términos, o por cualquier otro motivo a nuestra entera discreción, con o sin aviso.</li>
              <li>Podemos suspender el servicio por mantenimiento, actualizaciones u otros motivos operativos.</li>
              <li>Con la cancelación, tu derecho a usar la Aplicación cesa de inmediato.</li>
              <li>Los datos eliminados no pueden recuperarse. No somos responsables de la pérdida de datos derivada de la eliminación de la cuenta.</li>
              <li>Las Secciones 4, 5, 6, 11, 12, 13, 14, 15, 16 y 18 sobreviven a la cancelación.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">18. Ley aplicable y jurisdicción</h2>
            <p>Estos Términos se regirán e interpretarán de acuerdo con las leyes del Estado de Texas, Estados Unidos, sin tener en cuenta sus disposiciones sobre conflicto de leyes. Con sujeción a la disposición de arbitraje anterior, cualquier acción legal derivada de estos Términos se presentará exclusivamente ante los tribunales estatales o federales situados en Texas, y aceptas la jurisdicción personal de dichos tribunales.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">19. Fuerza mayor</h2>
            <p>No seremos responsables de ningún fallo, retraso, suspensión, pérdida de datos, rendimiento degradado, falta de entrega o discontinuación que resulte de causas ajenas a nuestro control razonable, incluidos, entre otros, casos de fuerza mayor, desastres naturales, guerra, terrorismo, pandemias, conflictos laborales, acciones gubernamentales, acción regulatoria, acción de la App Store, de Google Play o de la plataforma, cortes de energía, fallos de internet o de telecomunicaciones, caídas de proveedores en la nube, caídas de procesadores de pago, caídas de proveedores de IA, cambios de API de terceros, cambios de proveedores de MCG, límites de frecuencia, incidentes de seguridad o interrupciones de servicios de terceros.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">20. Divisibilidad</h2>
            <p>Si alguna disposición de estos Términos se considera inválida, ilegal o inexigible, las disposiciones restantes seguirán en pleno vigor y efecto. La disposición inválida se modificará en la mínima medida necesaria para hacerla válida y exigible, preservando su intención original.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">21. Acuerdo completo</h2>
            <p>Estos Términos, junto con la Política de Privacidad y cualesquiera condiciones de compra presentadas por Apple, Stripe u otro proveedor de pago, constituyen el acuerdo completo entre tú y StatsKey en relación con tu uso de la Aplicación y prevalecen sobre todos los acuerdos, entendimientos, promesas, declaraciones y representaciones anteriores, incluidas cualesquiera declaraciones sobre funciones, elementos de la hoja de ruta, plazos, precios, integraciones o entregables futuros.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">22. Contacto</h2>
            <p>Para preguntas sobre estos Términos:</p>
            <p class="mt-2"><strong class="text-text-primary">Correo electrónico:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">Al usar StatsKey, reconoces que has leído, entendido y aceptas quedar obligado por estos Términos del Servicio y por nuestra <a href="/privacy" class="text-accent hover:underline">Política de Privacidad</a>.</p>
          </section>
  `,
}

const de = {
  __title: 'Nutzungsbedingungen — StatsKey',
  'lp-title': 'Nutzungsbedingungen',
  'lp-date':
    'Gültig ab: 6. September 2026<span class="block mt-2 italic">Diese deutsche Übersetzung dient nur zur Information. Bei Abweichungen ist die englische Originalfassung maßgeblich.</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. Annahme der Bedingungen</h2>
            <p>Durch das Herunterladen, Installieren, den Zugriff auf oder die Nutzung von StatsKey („die Anwendung“) erklärst du dich mit diesen Nutzungsbedingungen („Bedingungen“) einverstanden. Wenn du nicht allen diesen Bedingungen zustimmst, darfst du die Anwendung nicht nutzen. Wir behalten uns das Recht vor, diese Bedingungen jederzeit zu ändern. Deine fortgesetzte Nutzung der Anwendung nach Änderungen gilt als Annahme der überarbeiteten Bedingungen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. Beschreibung des Dienstes</h2>
            <p class="mb-3">StatsKey ist eine Anwendung zur Erfassung von Ernährung, Fitness und biometrischen Daten, die Folgendes bietet:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>KI-gestützte Lebensmittelerkennung und Nährwertschätzung aus Fotos und Text</li>
              <li>Nährwertanalyse und -erfassung von mehr als 50 Nährstoffen</li>
              <li>Erfassung von Sport, Aktivitäten und Workouts</li>
              <li>Überwachung von Gewicht und Körperwerten</li>
              <li>Integration kontinuierlicher Glukosemessgeräte (CGM) und Synchronisierung historischer Glukosedaten</li>
              <li>Integration von Apple Health (iOS) und Android Health Connect, einschließlich des optionalen Imports historischer Daten, die du autorisierst</li>
              <li>KI-Dialogfunktionen für Abfragen von Gesundheitsdaten, einschließlich Abfragen, die synchronisierte historische Glukosedaten verwenden</li>
              <li>Cloud-Synchronisierung</li>
            </ul>
            <p class="mt-3">Funktionen können jederzeit ohne Vorankündigung hinzugefügt, geändert, eingeschränkt, ausgesetzt, umbenannt, ersetzt oder entfernt werden.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. Nutzerkonten</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Du musst mindestens 13 Jahre alt sein, um StatsKey zu nutzen.</li>
              <li>Du musst genaue und vollständige Kontoinformationen angeben.</li>
              <li>Du bist allein dafür verantwortlich, die Vertraulichkeit und Sicherheit deiner Kontozugangsdaten zu wahren.</li>
              <li>Ein Konto pro Person.</li>
              <li>Du musst uns unverzüglich über jeden unbefugten Zugriff auf dein Konto oder dessen unbefugte Nutzung informieren.</li>
              <li>Du bist für alle Aktivitäten verantwortlich, die unter deinem Konto stattfinden.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. Medizinischer Hinweis</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02] text-text-primary">
              <strong>WICHTIG — BITTE SORGFÄLTIG LESEN.</strong> StatsKey ist KEIN Medizinprodukt, ist NICHT dazu bestimmt, Krankheiten oder medizinische Zustände zu diagnostizieren, zu behandeln, zu heilen oder zu verhüten, und ist KEIN Ersatz für professionelle medizinische Beratung, Diagnose, Behandlung, Glukoseüberwachung oder Diabetes-Management. Alle Nährwertangaben, Glukosedaten-Anzeigen, Glukose-Trendanalysen, biometrischen Korrelationen, Gesundheitseinblicke, Berichte, Warnungen, Zusammenfassungen und KI-generierten Ergebnisse von StatsKey sind nur Schätzungen und Näherungswerte. Sie können verzögert, ungenau, unvollständig, nicht verfügbar oder falsch sein. Nutze StatsKey, synchronisierte Glukosedaten, Warnungen, Zusammenfassungen, KI-Ergebnisse, Berichte oder andere Inhalte der Anwendung nicht, um Entscheidungen zur Insulindosierung, Medikamentenentscheidungen, Entscheidungen zur Behandlung von Hypoglykämie oder Hyperglykämie, Notfallentscheidungen oder andere medizinische Entscheidungen zu treffen. Nutze für medizinische Entscheidungen das jeweilige CGM-Gerät, die vom Hersteller bereitgestellte Anwendung oder den Empfänger, die Produktkennzeichnung, gegebenenfalls Blutzuckermessungen mit einem Messgerät sowie den Rat deines qualifizierten medizinischen Fachpersonals. Ignoriere niemals professionellen medizinischen Rat und verzögere nicht die Suche nach einer Behandlung wegen Informationen, die StatsKey bereitstellt. Du übernimmst die volle Verantwortung dafür, wie du Informationen der Anwendung nutzt. Wenn du einen medizinischen Notfall hast, rufe sofort die örtlichen Notdienste an.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. Hinweis zu KI-generierten Inhalten</h2>
            <p>StatsKey nutzt KI-Dienste von Drittanbietern (einschließlich, aber nicht beschränkt auf Google Gemini, Anthropic Claude, OpenAI ChatGPT, xAI Grok und andere Anbieter, die wir auswählen können), um Essensfotos zu analysieren, den Nährwertgehalt zu schätzen, Trainings- oder Ernährungsinhalte zu erstellen und dialogbasierte Antworten zu deinen Gesundheitsdaten zu erzeugen. Wenn du die entsprechenden Funktionen aktivierst, können KI-Dialogantworten synchronisierte historische Gesundheitsdaten verwenden, einschließlich Glukosedaten, die aus Apple Health, von CGM-Anbietern oder aus anderen Quellen importiert und über Firebase / Google Cloud Platform in deinem StatsKey-Konto gesichert wurden. KI-generierte Inhalte werden „wie besehen“ bereitgestellt. Wir geben keine Zusicherungen oder Garantien hinsichtlich ihrer Genauigkeit, Vollständigkeit, Zuverlässigkeit, Aktualität, Sicherheit oder Eignung für einen bestimmten Zweck. KI-Ergebnisse können Fehler, Halluzinationen, Auslassungen, veraltete oder irreführende Informationen enthalten. Du solltest jede von KI generierte Information unabhängig überprüfen, bevor du dich darauf verlässt, und du darfst dich nicht auf KI-Ergebnisse für medizinische, klinische, Insulindosierungs-, Notfall-, rechtliche, finanzielle oder sicherheitskritische Entscheidungen verlassen. KI-Anbieter, Modelle, Prompts, Routing, Limits und Verfügbarkeit können sich jederzeit ohne Vorankündigung ändern.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. Keine garantierten Funktionen, Roadmap oder Verfügbarkeit</h2>
            <p class="mb-3">StatsKey wird als sich weiterentwickelnde Anwendung bereitgestellt. Wir garantieren nicht, dass eine aktuelle, angekündigte, geplante, experimentelle, Beta-, Vorschau-, Early-Access- oder zukünftige Funktion eingeführt wird, fortbesteht, für jeden Nutzer funktioniert, auf jedem Gerät funktioniert, in jeder Region funktioniert, kostenlos bleibt oder in einer Abostufe enthalten ist, im Wesentlichen gleich bleibt oder deine Erwartungen bzw. deinen beabsichtigten Verwendungszweck erfüllt.</p>
            <p class="mb-3">Dies gilt für alle Funktionen und Dienste der Anwendung, einschließlich, aber nicht beschränkt auf KI-Lebensmittelerkennung, Barcode- oder Etikettenscan, Nährwertschätzungen, Nährstoffdatenbanken, Ziele, Berichte, Dashboards, Intelligence-Chat, generierte Pläne, generierte Einblicke, Glukoseanzeigen, Glukose-Trendanalyse, CGM-Verbindungen, Dexcom Share, Dexcom-API, Abbott LibreLinkUp, Nightscout, Apple-Health- und Health-Connect-Import oder -Export, Synchronisierung historischer Gesundheitsdaten, Cloud-Synchronisierung, Backups, Datenexport, Freunde, soziale Feeds, Nachrichten, Teilen, Abonnements, App-Store-Abrechnung, Google-Play-Abrechnung, Stripe-Abrechnung, Workout-Erfassung, GPS, Routenkarten, Wetter, Benachrichtigungen, Widgets, Integrationen, Webfunktionen sowie jede Roadmap, Demo, jeden Screenshot, jede Support-Aussage, Marketingaussage, jeden App-Store-Text, jede Aussage auf einer Preisseite oder jede andere öffentliche oder private Kommunikation über StatsKey.</p>
            <p class="mb-3">Sofern diese Bedingungen nicht ausdrücklich etwas anderes bestimmen, sind Aussagen über Funktionen, Zeitpläne, Leistung, Integrationen, Preise, Kompatibilität, Modelle, Anbieter, Verfügbarkeit (Uptime), Genauigkeit oder Zukunftspläne nur informativ und stellen keine verbindlichen Zusagen, Garantien, Service-Level-Vereinbarungen oder Gewährleistungen dar. Bezahlter Zugang besteht, falls überhaupt, für die Anwendung in der Form, in der sie während des jeweiligen Abozeitraums bereitgestellt wird, und nicht für eine bestimmte Funktion, Integration, einen Anbieter, eine Datenquelle, einen Berichtstyp, ein KI-Modell, ein KI-Ergebnis, eine Synchronisierungsfähigkeit, ein klinisches Ergebnis, ein Geschäftsergebnis oder eine zukünftige Lieferung.</p>
            <p class="mb-3">Wir können jede Funktion oder jeden Dienst jederzeit, mit oder ohne Vorankündigung, aus beliebigem Grund aussetzen, einschränken, messen, drosseln, verzögern, verweigern, entfernen, ersetzen, umbenennen, regional beschränken, kontobezogen beschränken, gerätebezogen beschränken, gesondert berechnen oder einstellen, einschließlich aus betrieblichen Gründen, wegen Wartung, Sicherheit, Missbrauchsprävention, Schutz, rechtlicher oder regulatorischer Bedenken, App-Store- oder Plattformprüfung, Anforderungen Dritter, Anbieterausfällen, API-Änderungen, Ratenlimits, Kontoberechtigungen, Problemen mit Zugangsdaten, Sensor- oder Geräteproblemen, Cloud-Ausfällen, Änderungen von KI-Anbietern, Datenqualitätsproblemen, geschäftlichen Gründen oder unserer Einschätzung, dass eine Funktion nicht angeboten werden sollte.</p>
            <p>Du bist dafür verantwortlich, jedes Gerät, jeden Sensor, jedes Konto, jedes Abonnement, jedes Betriebssystem, jede Netzwerkverbindung, jede Berechtigung, jede Zugangsdaten, jede Drittanbieter-App, jede Hersteller-App, jeden Empfänger und jede Anbieterautorisierung bereitzuhalten, die für die Funktion optionaler Features erforderlich sind. Du solltest dich nicht auf StatsKey oder eine angekündigte Funktion als deine einzige Datenkopie, einzige Quelle für Gesundheitsinformationen, einzigen Arbeitsablauf für die Versorgung, einzige Abrechnungsaufzeichnung, einzigen Kommunikationskanal oder einziges Mittel zur Erfüllung einer rechtlichen, medizinischen, beruflichen, sportlichen, ernährungsbezogenen oder geschäftlichen Verpflichtung verlassen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. Zulässige Nutzung</h2>
            <p class="mb-3"><strong class="text-text-primary">Du darfst:</strong></p>
            <ul class="list-disc pl-5 space-y-1 mb-4">
              <li>StatsKey für die persönliche Erfassung von Ernährung, Fitness und Gesundheit nutzen.</li>
              <li>Deine eigenen Daten mit medizinischem Fachpersonal teilen.</li>
              <li>Deine Daten für den persönlichen Gebrauch exportieren.</li>
            </ul>
            <p class="mb-3"><strong class="text-text-primary">Du darfst nicht:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Die Anwendung für rechtswidrige Zwecke nutzen.</li>
              <li>Versuchen, die Anwendung zurückzuentwickeln (Reverse Engineering), zu dekompilieren oder zu disassemblieren.</li>
              <li>Daten anderer Nutzer teilen, verkaufen oder verbreiten.</li>
              <li>Automatisierte Systeme, Bots oder Skripte verwenden, um auf die Anwendung zuzugreifen.</li>
              <li>Unangemessene, anstößige oder illegale Inhalte hochladen.</li>
              <li>Unsere API ausnutzen oder versuchen, mehr Daten zu erfassen, als ein Mensch an einem einzigen Tag vernünftigerweise erfassen könnte.</li>
              <li>Sicherheitsmaßnahmen oder Zugangskontrollen umgehen.</li>
              <li>Die Anwendung, CGM-Integrationen oder Zugangsdaten, Tokens, Sitzungen, APIs oder Daten Dritter in einer Weise nutzen, die gegen die anwendbaren Bedingungen Dritter, Entwicklervereinbarungen, Produktkennzeichnungen, behördliche Zulassungen oder Zugangsberechtigungen verstößt.</li>
              <li>Eine CGM-Integration für die automatisierte Insulinabgabe, die aktive Patientenüberwachung, die zu unmittelbarem klinischem Handeln führen soll, die Krankenhaus- oder stationäre Überwachung, die Notfallreaktion, klinische Studien, regulierte Medizinproduktfunktionen oder eine andere Nutzung verwenden, die eine behördliche Zulassung oder Anbieterautorisierung erfordert, die StatsKey nicht ausdrücklich erlangt hat.</li>
              <li>Die Anwendung nutzen, um ein konkurrierendes Produkt oder einen konkurrierenden Dienst zu entwickeln.</li>
            </ul>
            <p class="mt-3">Jeder Verstoß gegen diese Beschränkungen kann zur sofortigen Kündigung deines Kontos und zum Widerruf deines Abonnements ohne Rückerstattung führen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. Abonnement und Zahlung</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKey bietet einen kostenlosen Testzeitraum, nach dem ein kostenpflichtiges Abonnement erforderlich ist.</li>
              <li>In-App-Abonnements werden über den App Store von Apple (iOS) oder Google Play (Android) abgerechnet und unterliegen den Bedingungen von Apple bzw. Google; auf unserer Website abgeschlossene Abonnements werden über Stripe abgerechnet.</li>
              <li>Dein Abonnement verlängert sich automatisch, sofern du nicht mindestens 24 Stunden vor Ende des laufenden Abrechnungszeitraums kündigst.</li>
              <li>Dein einziges Rechtsmittel bei Unzufriedenheit mit dem Dienst ist die Kündigung deines Abonnements.</li>
              <li>Abonnementgebühren sind nicht erstattungsfähig, außer wenn dies nach geltendem Recht erforderlich ist.</li>
              <li>Wir garantieren nicht, dass eine Funktion stets verfügbar, ununterbrochen, genau, aktuell oder fehlerfrei ist.</li>
              <li>Abonnementgebühren berechtigen dich nicht zu einer bestimmten aktuellen oder zukünftigen Funktion, Integration, einem Anbieter, KI-Modell, einer Datenquelle, einem Bericht, einer Synchronisierungsfähigkeit oder einem Verfügbarkeitsniveau, außer wenn dies nach geltendem Recht erforderlich ist.</li>
              <li>Wir behalten uns das Recht vor, die Preise mit angemessener Vorankündigung zu ändern.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. Geistiges Eigentum</h2>
            <p class="mb-3" data-public-disclosure-commitment="true"><strong class="text-text-primary">Keine öffentliche Offenlegung.</strong> StatsKey und sein Gründer werden deine Standortdaten oder Informationen zu deinem Wohlbefinden, deiner Gesundheit oder Fitness, die dich identifizieren oder sich vernünftigerweise mit dir verknüpfen lassen, weder veröffentlichen noch auf andere Weise öffentlich weitergeben. Dies umfasst öffentliche Beiträge, Werbung, Vorführungen und Fallstudien. Du kannst deine eigenen Daten weiterhin auf Wunsch privat mit von dir ausgewählten Personen teilen. Die notwendige Verarbeitung durch Dienstleister und gesetzlich vorgeschriebene Offenlegungen unterliegen weiterhin unserer <a href="/privacy" class="text-accent hover:underline">Datenschutzerklärung</a>.</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKey, sein Design, Code, Inhalt, seine Marken und alle Originalmaterialien sind das ausschließliche Eigentum von StatsKey und durch Urheber-, Marken- und andere Gesetze zum geistigen Eigentum geschützt.</li>
              <li>Du behältst das Eigentum an deinen personenbezogenen Daten.</li>
              <li>Durch die Nutzung der Anwendung gewährst du uns eine begrenzte, nicht ausschließliche, weltweite Lizenz zur Verarbeitung, Speicherung und Übertragung deiner Daten, ausschließlich um den Dienst bereitzustellen und zu verbessern.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. Standortdienste</h2>
            <p class="mb-3">StatsKey nutzt Standortdienste, um die Workout-Erfassung zu verbessern. Wenn du Standortdienste aktivierst:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">Standort im Hintergrund:</strong> Wird nur während einer aktiven Workout-Sitzung abgerufen, um Route, Distanz, Pace und Höhenmeter zu verfolgen. Endet, wenn das Workout beendet oder pausiert wird.</li>
              <li><strong class="text-text-primary">Standort im Vordergrund:</strong> Wird abgerufen, während die App aktiv genutzt wird, für die Kartenanzeige und die Genauigkeit der Aktivitätserfassung.</li>
              <li>Standortdaten werden auf deinem Gerät gespeichert und, wenn die Cloud-Synchronisierung aktiviert ist, in deinem verschlüsselten Konto.</li>
              <li>Wir verkaufen, teilen oder monetarisieren Standortdaten nicht mit Dritten.</li>
              <li>Du kannst die Standortdienste jederzeit deaktivieren; dies kann jedoch die Funktionalität der Workout-Erfassung einschränken.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. Drittanbieter-Dienste</h2>
            <p class="mb-3">StatsKey integriert sich mit Diensten Dritter, einschließlich, aber nicht beschränkt auf:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Apple HealthKit (iOS) und Android Health Connect, einschließlich des optionalen Imports von Gesundheits- und Glukosedaten (unterliegt den Bedingungen von Apple bzw. Google)</li>
              <li>Anmeldung mit Apple und Google (unterliegt den jeweiligen Bedingungen)</li>
              <li>Firebase / Google Cloud Platform (unterliegt den Bedingungen von Google)</li>
              <li>Apple App Store und Google Play, einschließlich der In-App-Abonnementabrechnung (unterliegen den jeweiligen Bedingungen)</li>
              <li>CGM-Anbieter und -Dienste (einschließlich Dexcom-CGM-Systeme, Dexcom Share, Abbott LibreLinkUp und Nightscout — unterliegen den jeweiligen Bedingungen, Datenschutzerklärungen, Produktkennzeichnungen und der Verfügbarkeit)</li>
              <li>KI-Anbieter (einschließlich Google, Anthropic, OpenAI, xAI und anderer Anbieter, die wir auswählen können — unterliegen den jeweiligen Bedingungen)</li>
            </ul>
            <p class="mt-3">Wir sind nicht verantwortlich für die Verfügbarkeit, Genauigkeit, Sicherheit, Rechtmäßigkeit, Leistung, Kontinuität, Preise, Ratenlimits, Richtlinien oder Praktiken eines Drittanbieterdienstes. Deine Nutzung von Drittanbieterdiensten erfolgt auf eigenes Risiko und unterliegt den Bedingungen dieser Parteien. Du bist dafür verantwortlich, jedes Drittanbieterkonto, Gerät, jeden Sensor, Empfänger, jede mobile App, Berechtigungen, Autorisierungen, Internetverbindung und Produkteinrichtung bereitzuhalten, die für die Funktion dieser Dienste erforderlich sind. Wir können eine Drittanbieter-Integration deaktivieren, einschränken oder entfernen, wenn der Anbieter den Zugang ändert, der Integration widerspricht, Limits auferlegt, die Bedingungen ändert, einen Ausfall erleidet oder wenn wir feststellen, dass die Fortführung der Integration ein rechtliches, sicherheitsbezogenes, betriebliches, regulatorisches oder geschäftliches Risiko schafft.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. Dexcom- und CGM-Datenintegration</h2>
            <p class="mb-3">StatsKey kann dir ermöglichen, Daten kontinuierlicher Glukosemessgeräte von Diensten Dritter zu verbinden, einschließlich Dexcom-CGM-Systemen, Dexcom Share, Apple Health, Abbott LibreLinkUp und Nightscout. Diese Integrationen sind optional und werden nur aktiviert, wenn du die erforderlichen Berechtigungen, Zugangsdaten, die URL oder andere Verbindungsinformationen bereitstellst.</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">Autorisierung.</strong> Durch das Verbinden eines CGM-Dienstes erklärst du, dass du Inhaber des Kontos bist oder die rechtliche Befugnis hast, es zu verbinden, und du autorisierst StatsKey, Glukosewerte und zugehörige Metadaten in deinem Auftrag abzurufen, zu verarbeiten, anzuzeigen, zu speichern und zu synchronisieren.</li>
              <li><strong class="text-text-primary">Drittanbieterstatus.</strong> StatsKey ist mit keinem CGM-Anbieter verbunden, wird von keinem gesponsert, befürwortet, genehmigt oder validiert und handelt nicht als dessen Vertreter, sofern wir dies nicht ausdrücklich schriftlich erklären. Wenn ein Anbieter eine gesonderte Autorisierung, einen Produktionszugang, eine Prüfung, Zertifizierung oder Vereinbarung verlangt, ist die zugehörige Integration nur in dem Umfang verfügbar, den dieser Anbieter zulässt. Wir können die CGM-Funktionalität jederzeit einschränken, aussetzen oder deaktivieren, wenn dies von einem Anbieter, einer Plattform, einer Behörde, einem Sicherheitsbedenken, einer rechtlichen Verpflichtung oder unserer eigenen Risikobewertung verlangt oder empfohlen wird.</li>
              <li><strong class="text-text-primary">Bedingungen Dritter.</strong> Du musst die anwendbaren Bedingungen Dritter, Datenschutzerklärungen, Produktkennzeichnungen, Kontoregeln und Freigabeeinstellungen einhalten. Wir kontrollieren diese Bedingungen nicht und können nicht garantieren, dass ein Drittanbieter eine Integration weiterhin zulässt, unterstützt oder bereitstellt.</li>
              <li><strong class="text-text-primary">Widerruf und Trennung.</strong> Du kannst eine CGM-Integration in der Anwendung trennen, und einige Anbieter erlauben dir möglicherweise auch, die Autorisierung in den eigenen Kontoeinstellungen des Anbieters zu widerrufen. Die Trennung oder der Widerruf stoppt die zukünftige Synchronisierung, soweit technisch verfügbar, löscht jedoch nicht automatisch bereits in StatsKey importierte Glukosedaten; diese Daten unterliegen weiterhin unserer Datenschutzerklärung und deinen Löschrechten.</li>
              <li><strong class="text-text-primary">Verzögerung und Verfügbarkeit.</strong> CGM-Daten in StatsKey können verzögert, unvollständig, dupliziert, nicht verfügbar, simuliert, veraltet, transformiert, falsch beschriftet oder anders sein als die im eigenen Gerät, Empfänger oder in der Anwendung des Herstellers angezeigten Daten. Anbieterdienste können ohne Vorankündigung unterbrochen, ratenbegrenzt, geändert, ausgesetzt oder beendet werden. Sandbox- oder simulierte CGM-Daten dürfen nicht für klinische Validierung, das Training von Algorithmen, den Produktiveinsatz oder medizinische Entscheidungen verwendet werden.</li>
              <li><strong class="text-text-primary">Keine medizinische oder sicherheitskritische Nutzung.</strong> StatsKey ist eine Anwendung zur historischen Erfassung, Analyse und für das Wohlbefinden. Es ist kein Echtzeit-Glukosemonitor, kein Alarm, kein Fernüberwachungsdienst, kein Notfallbenachrichtigungssystem, kein Diabetes-Behandlungstool und keine Komponente zur automatisierten Insulinabgabe. Nutze StatsKey nicht, um Hypoglykämie oder Hyperglykämie zu erkennen, zu behandeln oder darauf zu reagieren, um Insulin zu berechnen oder zu verabreichen, um Medikamente anzupassen oder um andere medizinische Entscheidungen zu treffen.</li>
              <li><strong class="text-text-primary">Kein Missbrauch.</strong> Du darfst StatsKey nicht nutzen, um Zugangskontrollen zu umgehen, Drittanbieterdienste zu scrapen oder zu überlasten, die Integrität des Dienstes zu beeinträchtigen, ohne Autorisierung auf CGM-Daten zuzugreifen, eine andere Person ohne rechtliche Befugnis und Einwilligung zu überwachen, CGM-Produkte oder -Dienste zu vergleichen oder zu benchmarken, falsche oder irreführende Aussagen über einen CGM-Anbieter oder dessen Produkte zu machen oder CGM-Integrationen für klinische, kommerzielle, Notfall- oder regulierte Medizinproduktzwecke zu verwenden.</li>
            </ul>
            <p>Dexcom und Dexcom Share sind eingetragene oder nicht eingetragene Marken von Dexcom, Inc. in den Vereinigten Staaten und/oder anderen Ländern. Abbott, FreeStyle Libre und LibreLinkUp sind Marken von Abbott und seinen verbundenen Unternehmen. Nightscout ist ein Open-Source-Projekt und wird nicht von StatsKey betrieben.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. Haftungsausschlüsse</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              DIE ANWENDUNG UND ALLE INHALTE, FUNKTIONEN, INTEGRATIONEN, ERGEBNISSE, DATEN, BERICHTE, ANZEIGEN, WARNUNGEN, ZUSAMMENFASSUNGEN, KI-ANTWORTEN UND DIENSTE WERDEN „WIE BESEHEN“ UND „WIE VERFÜGBAR“ OHNE GEWÄHRLEISTUNGEN JEGLICHER ART BEREITGESTELLT, OB AUSDRÜCKLICH, STILLSCHWEIGEND, GESETZLICH ODER ANDERWEITIG. IM GRÖSSTMÖGLICHEN GESETZLICH ZULÄSSIGEN UMFANG SCHLIESSEN WIR ALLE GEWÄHRLEISTUNGEN AUS, EINSCHLIESSLICH, ABER NICHT BESCHRÄNKT AUF STILLSCHWEIGENDE GEWÄHRLEISTUNGEN DER MARKTGÄNGIGKEIT, DER EIGNUNG FÜR EINEN BESTIMMTEN ZWECK, DER NICHTVERLETZUNG, DES EIGENTUMS, DER UNGESTÖRTEN NUTZUNG, DER VERFÜGBARKEIT, DER PÜNKTLICHKEIT, DER KOMPATIBILITÄT UND DER GENAUIGKEIT. WIR GEWÄHRLEISTEN NICHT, DASS DIE ANWENDUNG UNUNTERBROCHEN, FEHLERFREI, SICHER, VERFÜGBAR, GENAU, VOLLSTÄNDIG, AKTUELL ODER FREI VON VIREN ODER ANDEREN SCHÄDLICHEN KOMPONENTEN IST. WIR GEWÄHRLEISTEN NICHT DIE GENAUIGKEIT, VOLLSTÄNDIGKEIT ODER ZUVERLÄSSIGKEIT VON NÄHRWERTSCHÄTZUNGEN, KI-GENERIERTEN INHALTEN, GESUNDHEITSEINBLICKEN, GLUKOSEANALYSEN, BIOMETRISCHEN KORRELATIONEN, BERICHTEN, SYNCHRONISIERTEN DATEN, DRITTANBIETERDATEN ODER FUNKTIONSERGEBNISSEN. ALLE DATEN UND ERGEBNISSE SIND NÄHERUNGSWERTE UND KÖNNEN FEHLER ENTHALTEN.
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. Haftungsbeschränkung</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              IM GRÖSSTMÖGLICHEN NACH GELTENDEM RECHT ZULÄSSIGEN UMFANG HAFTEN STATSKEY, SEINE FÜHRUNGSKRÄFTE, DIREKTOREN, MITARBEITER, AUFTRAGNEHMER, VERTRETER, DIENSTLEISTER ODER VERBUNDENEN UNTERNEHMEN IN KEINEM FALL FÜR INDIREKTE, BEILÄUFIGE, BESONDERE, FOLGE-, STRAF- ODER VERSCHÄRFTE SCHÄDEN, EINSCHLIESSLICH, ABER NICHT BESCHRÄNKT AUF SCHÄDEN AUS ENTGANGENEM GEWINN, UMSATZ, GESCHÄFTS- ODER FIRMENWERT (GOODWILL), DATEN, NUTZUNG, ABONNEMENTWERT, GESCHÄFTSCHANCE, GESUNDHEITSERGEBNISSEN, KÖRPERVERLETZUNG, SEELISCHEM LEID, PERSONENSCHÄDEN, GERÄTEAUSFALL, VERPASSTEN WARNUNGEN, VERPASSTER SYNCHRONISIERUNG, VERLORENEN DATEN, VERLASS AUF KI-ERGEBNISSE, VERLASS AUF GESUNDHEITS- ODER GLUKOSEINFORMATIONEN, NICHTLIEFERUNG EINER FUNKTION, VERZÖGERTER LIEFERUNG, ENTFERNUNG EINER FUNKTION, AUSFALL EINES DRITTANBIETERDIENSTES ODER ANDEREN IMMATERIELLEN VERLUSTEN, DIE SICH AUS ODER IM ZUSAMMENHANG MIT DEINER NUTZUNG ODER NICHTNUTZUNG DER ANWENDUNG ERGEBEN, UNABHÄNGIG VON DER HAFTUNGSGRUNDLAGE (VERTRAG, UNERLAUBTE HANDLUNG, FAHRLÄSSIGKEIT, GEFÄHRDUNGSHAFTUNG, PRODUKTHAFTUNG, GEWÄHRLEISTUNG, GESETZ ODER ANDERWEITIG), SELBST WENN WIR AUF DIE MÖGLICHKEIT SOLCHER SCHÄDEN HINGEWIESEN WURDEN. UNSERE GESAMTE HAFTUNG FÜR ALLE ANSPRÜCHE, DIE SICH AUS ODER IM ZUSAMMENHANG MIT DER ANWENDUNG ERGEBEN, ÜBERSTEIGT NICHT DEN HÖHEREN DER FOLGENDEN BETRÄGE: (A) DEN BETRAG, DEN DU UNS IN DEN ZWÖLF (12) MONATEN VOR DEM ANSPRUCH GEZAHLT HAST, ODER (B) EINHUNDERT US-DOLLAR (100 USD).
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. Freistellung</h2>
            <p>Du erklärst dich damit einverstanden, StatsKey, seine Führungskräfte, Direktoren, Mitarbeiter, Auftragnehmer, Vertreter, Dienstleister und verbundenen Unternehmen von und gegen alle Ansprüche, Haftungen, Schäden, Verluste, Kosten und Ausgaben (einschließlich angemessener Anwaltskosten) freizustellen, zu verteidigen und schadlos zu halten, die sich aus oder in irgendeiner Weise im Zusammenhang ergeben mit: (a) deiner Nutzung der Anwendung oder deinem Verlass darauf; (b) deinem Verstoß gegen diese Bedingungen; (c) deiner Verletzung von Rechten Dritter; (d) deinem Verstoß gegen Bedingungen Dritter, Produktkennzeichnungen, Anbieterregeln oder geltendes Recht; (e) deiner Nutzung einer Gesundheits-, Glukose-, KI-, Synchronisierungs-, Social-, Abrechnungs- oder Integrationsfunktion; oder (f) jedem Anspruch, dass deine Nutzung der Anwendung einem Dritten Schaden zugefügt hat.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. Streitbeilegung und Schiedsverfahren</h2>
            <p class="mb-3"><strong class="text-text-primary">Verbindliches Schiedsverfahren.</strong> Jede Streitigkeit, jeder Anspruch oder jede Kontroverse, die sich aus oder im Zusammenhang mit diesen Bedingungen oder der Anwendung ergibt, wird durch verbindliches Schiedsverfahren beigelegt, das von der American Arbitration Association („AAA“) nach deren Consumer Arbitration Rules durchgeführt wird, anstatt vor Gericht, mit der Ausnahme, dass jede Partei in Angelegenheiten des geistigen Eigentums gerichtlichen Unterlassungs- oder Billigkeitsschutz beantragen kann.</p>
            <p class="mb-3"><strong class="text-text-primary">Verzicht auf Sammelklagen.</strong> DU UND STATSKEY VEREINBAREN, DASS JEDER ANSPRÜCHE GEGEN DEN ANDEREN NUR IN SEINER INDIVIDUELLEN EIGENSCHAFT UND NICHT ALS KLÄGER ODER MITGLIED EINER KLASSE IN EINER VERMEINTLICHEN SAMMEL-, KONSOLIDIERTEN ODER REPRÄSENTATIVEN KLAGE GELTEND MACHEN DARF. Der Schiedsrichter darf die Ansprüche von mehr als einer Person nicht zusammenfassen und keine Form eines repräsentativen oder Sammelverfahrens leiten.</p>
            <p><strong class="text-text-primary">Widerspruch (Opt-out).</strong> Du kannst dieser Schiedsvereinbarung widersprechen, indem du innerhalb von 30 Tagen nach erstmaliger Annahme dieser Bedingungen eine schriftliche Mitteilung an ryanws@statskeybiometrics.com sendest. Wenn du widersprichst, werden Streitigkeiten vor den in Abschnitt 18 genannten Gerichten beigelegt.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. Kontokündigung</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>Du kannst dein Konto jederzeit über die Anwendung löschen.</li>
              <li>Wir können dein Konto jederzeit wegen eines Verstoßes gegen diese Bedingungen oder aus jedem anderen Grund nach unserem alleinigen Ermessen, mit oder ohne Vorankündigung, aussetzen oder kündigen.</li>
              <li>Wir können den Dienst für Wartung, Updates oder andere betriebliche Gründe aussetzen.</li>
              <li>Mit der Kündigung endet dein Recht zur Nutzung der Anwendung sofort.</li>
              <li>Gelöschte Daten können nicht wiederhergestellt werden. Wir sind nicht verantwortlich für Datenverluste, die sich aus der Kontolöschung ergeben.</li>
              <li>Die Abschnitte 4, 5, 6, 11, 12, 13, 14, 15, 16 und 18 bleiben nach der Kündigung in Kraft.</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">18. Anwendbares Recht und Gerichtsstand</h2>
            <p>Diese Bedingungen unterliegen den Gesetzen des Bundesstaates Texas, Vereinigte Staaten, und werden nach diesen ausgelegt, ohne Rücksicht auf deren Kollisionsnormen. Vorbehaltlich der vorstehenden Schiedsbestimmung wird jede sich aus diesen Bedingungen ergebende Klage ausschließlich vor den in Texas gelegenen Staats- oder Bundesgerichten erhoben, und du erklärst dich mit der persönlichen Zuständigkeit dieser Gerichte einverstanden.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">19. Höhere Gewalt</h2>
            <p>Wir haften nicht für Ausfälle, Verzögerungen, Aussetzungen, Datenverluste, verminderte Leistung, Nichtlieferung oder Einstellungen, die auf Ursachen außerhalb unserer angemessenen Kontrolle zurückzuführen sind, einschließlich, aber nicht beschränkt auf höhere Gewalt, Naturkatastrophen, Krieg, Terrorismus, Pandemien, Arbeitskämpfe, behördliche Maßnahmen, regulatorische Maßnahmen, Maßnahmen des App Stores, von Google Play oder der Plattform, Stromausfälle, Internet- oder Telekommunikationsausfälle, Ausfälle von Cloud-Anbietern, Ausfälle von Zahlungsabwicklern, Ausfälle von KI-Anbietern, API-Änderungen Dritter, Änderungen von CGM-Anbietern, Ratenlimits, Sicherheitsvorfälle oder Ausfälle von Drittanbieterdiensten.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">20. Salvatorische Klausel</h2>
            <p>Sollte eine Bestimmung dieser Bedingungen für ungültig, rechtswidrig oder undurchsetzbar befunden werden, bleiben die übrigen Bestimmungen in vollem Umfang in Kraft. Die ungültige Bestimmung wird im geringstmöglichen Umfang geändert, der erforderlich ist, um sie gültig und durchsetzbar zu machen, wobei ihre ursprüngliche Absicht gewahrt bleibt.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">21. Gesamte Vereinbarung</h2>
            <p>Diese Bedingungen bilden zusammen mit der Datenschutzerklärung und etwaigen von Apple, Stripe oder einem anderen Zahlungsanbieter vorgelegten Kaufbedingungen die gesamte Vereinbarung zwischen dir und StatsKey über deine Nutzung der Anwendung und ersetzen alle früheren Vereinbarungen, Absprachen, Zusagen, Aussagen und Zusicherungen, einschließlich etwaiger Aussagen über Funktionen, Roadmap-Punkte, Zeitpläne, Preise, Integrationen oder zukünftige Lieferungen.</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">22. Kontakt</h2>
            <p>Bei Fragen zu diesen Bedingungen:</p>
            <p class="mt-2"><strong class="text-text-primary">E-Mail:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">Durch die Nutzung von StatsKey bestätigst du, dass du diese Nutzungsbedingungen und unsere <a href="/privacy" class="text-accent hover:underline">Datenschutzerklärung</a> gelesen und verstanden hast und dich damit einverstanden erklärst.</p>
          </section>
  `,
}

const ja = {
  __title: '利用規約 — StatsKey',
  'lp-title': '利用規約',
  'lp-date':
    '発効日: 2026年9月6日<span class="block mt-2 italic">この日本語訳は参考用です。内容に相違がある場合は、英語の原文が優先されます。</span>',
  'lp-content': `
          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">1. 規約への同意</h2>
            <p>StatsKey（以下「本アプリケーション」）をダウンロード、インストール、アクセス、または利用することにより、お客様は本利用規約（以下「本規約」）に拘束されることに同意するものとします。これらの規約のすべてに同意されない場合は、本アプリケーションを利用してはなりません。当社は、本規約をいつでも変更する権利を留保します。変更後に本アプリケーションを継続して利用することは、改訂後の規約への同意を構成します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">2. サービスの説明</h2>
            <p class="mb-3">StatsKeyは、栄養、フィットネス、生体データを記録するアプリケーションであり、次の機能を提供します:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>写真とテキストからのAIによる食べ物の認識と栄養推定</li>
              <li>50以上の栄養素にわたる栄養分析と記録</li>
              <li>運動、アクティビティ、ワークアウトの記録</li>
              <li>体重と身体測定値のモニタリング</li>
              <li>持続血糖測定器（CGM）の連携と過去の血糖記録の同期</li>
              <li>Apple Health（iOS）およびAndroid Health Connectとの連携（お客様が許可した過去の記録の任意のインポートを含む）</li>
              <li>健康データのクエリのためのAI対話機能（同期された過去の血糖記録を使用するクエリを含む）</li>
              <li>クラウド同期</li>
            </ul>
            <p class="mt-3">機能は、予告なくいつでも追加、変更、制限、停止、改名、置換、または削除されることがあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">3. ユーザーアカウント</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKeyを利用するには、13歳以上である必要があります。</li>
              <li>正確かつ完全なアカウント情報を提供する必要があります。</li>
              <li>アカウントの認証情報の機密性と安全性を維持する責任は、お客様のみが負います。</li>
              <li>1人につき1つのアカウント。</li>
              <li>アカウントへの不正アクセスまたは不正利用があった場合は、直ちに当社に通知する必要があります。</li>
              <li>お客様のアカウントで発生するすべての活動について、お客様が責任を負います。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">4. 医療に関する免責事項</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02] text-text-primary">
              <strong>重要——よくお読みください。</strong> StatsKeyは医療機器ではなく、いかなる疾患や医学的状態の診断、治療、治癒、予防を目的としたものでもなく、専門的な医学的助言、診断、治療、血糖モニタリング、糖尿病管理の代替となるものでもありません。StatsKeyが提供するすべての栄養情報、血糖データの表示、血糖の傾向分析、生体相関、健康に関する洞察、レポート、アラート、要約、AIが生成した出力は、あくまで推定値および概算です。これらは遅延、不正確、不完全、利用不可、または誤りを含む可能性があります。StatsKey、同期された血糖記録、アラート、要約、AIの出力、レポート、その他の本アプリケーションのコンテンツを、インスリン投与量の決定、薬剤の決定、低血糖または高血糖の治療の決定、緊急時の決定、その他いかなる医療上の決定にも使用しないでください。医療上の決定には、該当するCGM機器、製造元が提供するアプリケーションまたは受信機、製品表示、必要に応じた血糖測定器による確認、および資格を有する医療専門家の助言を利用してください。StatsKeyが提供する情報を理由に、専門的な医学的助言を決して無視したり、治療を受けるのを遅らせたりしないでください。本アプリケーションが提供するいかなる情報の使用方法についても、お客様が全責任を負います。医療上の緊急事態が発生した場合は、直ちに現地の緊急サービスに連絡してください。
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">5. AIが生成したコンテンツに関する免責事項</h2>
            <p>StatsKeyは、食べ物の写真の分析、栄養成分の推定、トレーニングまたは栄養に関するコンテンツの生成、健康データに関する対話形式の応答の生成のために、第三者の人工知能サービス（Google Gemini、Anthropic Claude、OpenAI ChatGPT、xAI Grok、および当社が選択するその他のプロバイダーを含みますが、これらに限られません）を利用します。該当する機能を有効にした場合、AIの対話形式の応答は、Apple Health、CGMプロバイダー、その他のソースからインポートされ、Firebase / Google Cloud Platformを使用してStatsKeyアカウントにバックアップされた血糖記録を含む、同期された過去の健康記録を使用することがあります。AIが生成したコンテンツは「現状有姿（as-is）」で提供されます。当社は、その正確性、完全性、信頼性、適時性、安全性、または特定の目的への適合性について、いかなる表明も保証も行いません。AIの出力には、誤り、ハルシネーション、欠落、古い情報、または誤解を招く情報が含まれる場合があります。AIが生成した情報に依拠する前に、独自に検証する必要があり、医療、臨床、インスリン投与量、緊急、法律、財務、または安全に関わる決定にAIの出力を依拠してはなりません。AIプロバイダー、モデル、プロンプト、ルーティング、制限、提供状況は、予告なくいつでも変更されることがあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">6. 機能・ロードマップ・提供の無保証</h2>
            <p class="mb-3">StatsKeyは進化し続けるアプリケーションとして提供されます。当社は、現行、告知済み、計画中、実験的、ベータ、プレビュー、早期アクセス、または将来のいかなる機能についても、提供開始されること、継続すること、すべてのユーザーで動作すること、すべてのデバイスで動作すること、すべての地域で動作すること、無料のままであることまたはいずれかのサブスクリプション階層に含まれること、実質的に同じであり続けること、あるいはお客様の期待や意図した用途を満たすことを保証しません。</p>
            <p class="mb-3">これは、AIによる食べ物の認識、バーコードまたはラベルのスキャン、栄養推定、栄養素データベース、目標、レポート、ダッシュボード、Intelligenceチャット、生成されたプラン、生成された洞察、血糖表示、血糖の傾向分析、CGM接続、Dexcom Share、Dexcom API、Abbott LibreLinkUp、Nightscout、Apple HealthおよびAndroid Health Connectのインポートまたはエクスポート、過去の健康記録の同期、クラウド同期、バックアップ、データのエクスポート、フレンド、ソーシャルフィード、メッセージ、共有、サブスクリプション、App Store課金、Google Play課金、Stripe課金、ワークアウトの記録、GPS、ルートマップ、天気、通知、ウィジェット、連携、ウェブ機能、ならびにStatsKeyに関するあらゆるロードマップ、デモ、スクリーンショット、サポートの記述、マーケティング上の主張、アプリストアのテキスト、価格ページの記述、その他の公的または私的な連絡を含め、本アプリケーションのすべての機能およびサービスに適用されます。</p>
            <p class="mb-3">本規約が明示的に別段の定めをする場合を除き、機能、時期、性能、連携、価格、互換性、モデル、プロバイダー、稼働時間、正確性、または将来の計画に関する記述は情報提供のみを目的とし、拘束力のある約束、保証、サービスレベル契約、または保証ではありません。有料アクセスがある場合、それは該当するサブスクリプション期間中に提供される本アプリケーションに対するものであり、特定の機能、連携、プロバイダー、データソース、レポートの種類、AIモデル、AIの結果、同期機能、臨床的成果、事業上の成果、または将来の成果物に対するものではありません。</p>
            <p class="mb-3">当社は、運用上の必要、保守、セキュリティ、不正防止、保護、法的または規制上の懸念、App Storeまたはプラットフォームの審査、第三者の要件、プロバイダーの停止、APIの変更、レート制限、アカウントの権限、認証情報の問題、センサーまたはデバイスの問題、クラウドの障害、AIプロバイダーの変更、データ品質の問題、事業上の理由、または機能を提供すべきでないという当社の判断を含む理由により、いかなる機能またはサービスも、予告の有無にかかわらず、いつでも、いかなる理由でも、停止、制限、計測、抑制（スロットリング）、遅延、拒否、削除、置換、改名、地域制限、アカウント制限、デバイス制限、別途課金、または提供終了することができます。</p>
            <p>任意の機能が動作するために必要なデバイス、センサー、アカウント、サブスクリプション、オペレーティングシステム、ネットワーク接続、権限、認証情報、第三者アプリ、製造元アプリ、受信機、プロバイダーの認可を維持する責任は、お客様にあります。StatsKeyまたは告知されたいかなる機能も、データの唯一のコピー、健康情報の唯一の情報源、ケアのための唯一のワークフロー、唯一の課金記録、唯一の連絡手段、または法的、医療的、専門的、運動上、食事上、もしくは事業上の義務を果たす唯一の手段として依拠すべきではありません。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">7. 許容される利用</h2>
            <p class="mb-3"><strong class="text-text-primary">次のことが許可されます:</strong></p>
            <ul class="list-disc pl-5 space-y-1 mb-4">
              <li>個人の栄養、フィットネス、健康の記録のためにStatsKeyを利用すること。</li>
              <li>ご自身のデータを医療提供者と共有すること。</li>
              <li>個人利用のためにご自身のデータをエクスポートすること。</li>
            </ul>
            <p class="mb-3"><strong class="text-text-primary">次のことは禁止されます:</strong></p>
            <ul class="list-disc pl-5 space-y-1">
              <li>違法な目的で本アプリケーションを利用すること。</li>
              <li>本アプリケーションのリバースエンジニアリング、逆コンパイル、または逆アセンブルを試みること。</li>
              <li>他のユーザーのデータを共有、販売、または配布すること。</li>
              <li>自動化されたシステム、ボット、またはスクリプトを使用して本アプリケーションにアクセスすること。</li>
              <li>不適切、攻撃的、または違法なコンテンツをアップロードすること。</li>
              <li>当社のAPIを悪用すること、または人間が1日に合理的に記録できる量を超えてデータを記録しようとすること。</li>
              <li>セキュリティ対策またはアクセス制御を回避すること。</li>
              <li>本アプリケーション、CGM連携、または第三者の認証情報、トークン、セッション、API、データを、適用される第三者の規約、開発者契約、製品表示、規制上の承認、またはアクセス権限に違反する方法で使用すること。</li>
              <li>いかなるCGM連携も、自動インスリン投与、即時の臨床的対応を促すことを意図した能動的な患者モニタリング、病院または入院患者のモニタリング、緊急対応、臨床試験、規制対象の医療機器機能、またはStatsKeyが明示的に取得していない規制当局もしくはプロバイダーの認可を必要とするその他の用途に使用すること。</li>
              <li>競合する製品またはサービスを開発するために本アプリケーションを利用すること。</li>
            </ul>
            <p class="mt-3">これらの制限に違反した場合、アカウントの即時終了およびサブスクリプションの返金なしでの取り消しにつながることがあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">8. サブスクリプションと支払い</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKeyは無料の試用期間を提供し、その後は有料サブスクリプションが必要です。</li>
              <li>アプリ内のサブスクリプションはApple App Store（iOS）またはGoogle Play（Android）を通じて課金され、AppleまたはGoogleの利用規約が適用されます。当社のウェブサイトで購入したサブスクリプションはStripeを通じて課金されます。</li>
              <li>サブスクリプションは、現在の課金期間の終了の少なくとも24時間前に解約しない限り、自動的に更新されます。</li>
              <li>サービスへの不満に対するお客様の唯一の救済手段は、サブスクリプションの解約です。</li>
              <li>サブスクリプション料金は、適用される法律で義務付けられている場合を除き、返金されません。</li>
              <li>当社は、いかなる機能も常に利用可能、中断のない、正確、適時、またはエラーがないことを保証しません。</li>
              <li>サブスクリプション料金は、適用される法律で義務付けられている場合を除き、特定の現在または将来の機能、連携、プロバイダー、AIモデル、データソース、レポート、同期機能、または稼働時間の水準に対する権利をお客様に付与するものではありません。</li>
              <li>当社は、合理的な予告をもって価格を変更する権利を留保します。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">9. 知的財産</h2>
            <p class="mb-3" data-public-disclosure-commitment="true"><strong class="text-text-primary">公開しないことへの確約。</strong> StatsKeyおよびその創業者は、お客様の位置情報、またはお客様を特定できる、もしくは合理的にお客様と結び付けられるウェルネス・健康・フィットネス情報を公開したり、その他の方法で公に共有したりしません。これには、公開の投稿、広告、デモンストレーション、事例紹介が含まれます。お客様ご自身のデータは、引き続きお客様が選んだ相手と非公開で共有できます。サービス提供者による必要な処理および法律で義務付けられた開示には、引き続き当社の<a href="/privacy" class="text-accent hover:underline">プライバシーポリシー</a>が適用されます。</p>
            <ul class="list-disc pl-5 space-y-2">
              <li>StatsKey、そのデザイン、コード、コンテンツ、商標、およびすべてのオリジナル素材は、StatsKeyの独占的財産であり、著作権、商標、その他の知的財産法によって保護されています。</li>
              <li>お客様は、ご自身の個人データの所有権を保持します。</li>
              <li>本アプリケーションを利用することにより、お客様は、サービスを提供および改善するためにのみ、お客様のデータを処理、保存、送信するための、限定的、非独占的、世界的なライセンスを当社に付与します。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">10. 位置情報サービス</h2>
            <p class="mb-3">StatsKeyは、ワークアウトの記録を向上させるために位置情報サービスを使用します。位置情報サービスを有効にすると:</p>
            <ul class="list-disc pl-5 space-y-2">
              <li><strong class="text-text-primary">バックグラウンドの位置情報:</strong> ルート、距離、ペース、標高を記録するため、アクティブなワークアウトセッション中にのみアクセスされます。ワークアウトが終了または一時停止されると停止します。</li>
              <li><strong class="text-text-primary">フォアグラウンドの位置情報:</strong> 地図表示およびアクティビティ記録の精度のため、アプリがアクティブに使用されている間にアクセスされます。</li>
              <li>位置情報データはお客様のデバイスに保存され、クラウド同期が有効な場合は暗号化されたアカウントにも保存されます。</li>
              <li>当社は、位置情報データを第三者に販売、共有、または収益化しません。</li>
              <li>位置情報サービスはいつでも無効にできますが、これによりワークアウト記録の機能が制限される場合があります。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">11. 第三者サービス</h2>
            <p class="mb-3">StatsKeyは、次のものを含みますがこれらに限られない第三者サービスと連携します:</p>
            <ul class="list-disc pl-5 space-y-1">
              <li>Apple HealthKit（iOS）およびAndroid Health Connect（健康および血糖記録の任意のインポートを含む。AppleまたはGoogleの規約が適用されます）</li>
              <li>AppleおよびGoogleでのサインイン（それぞれの規約が適用されます）</li>
              <li>Firebase / Google Cloud Platform（Googleの規約が適用されます）</li>
              <li>Apple App StoreおよびGoogle Play（アプリ内のサブスクリプション課金を含む。それぞれの規約が適用されます）</li>
              <li>CGMプロバイダーおよびサービス（Dexcom CGMシステム、Dexcom Share、Abbott LibreLinkUp、Nightscoutを含む。それぞれの規約、プライバシーポリシー、製品表示、提供状況が適用されます）</li>
              <li>AIプロバイダー（Google、Anthropic、OpenAI、xAI、および当社が選択するその他のプロバイダーを含む。それぞれの規約が適用されます）</li>
            </ul>
            <p class="mt-3">当社は、いかなる第三者サービスの提供状況、正確性、セキュリティ、適法性、性能、継続性、価格、レート制限、ポリシー、または慣行についても責任を負いません。第三者サービスの利用はお客様自身の責任で行われ、それらの当事者の規約が適用されます。これらのサービスが機能するために必要な第三者のアカウント、デバイス、センサー、受信機、モバイルアプリ、権限、認可、インターネット接続、製品設定を維持する責任は、お客様にあります。プロバイダーがアクセスを変更した場合、連携に異議を唱えた場合、制限を課した場合、規約を変更した場合、停止が発生した場合、または連携の継続が法的、セキュリティ上、運用上、規制上、もしくは事業上のリスクを生じさせると当社が判断した場合、当社は第三者の連携を無効化、制限、または削除することがあります。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">12. DexcomおよびCGMデータの連携</h2>
            <p class="mb-3">StatsKeyは、Dexcom CGMシステム、Dexcom Share、Apple Health、Abbott LibreLinkUp、Nightscoutを含む第三者サービスからの持続血糖測定器データの接続を許可する場合があります。これらの連携は任意であり、必要な権限、認証情報、URL、その他の接続情報を提供した場合にのみ有効になります。</p>
            <ul class="list-disc pl-5 space-y-2 mb-3">
              <li><strong class="text-text-primary">認可。</strong> CGMサービスを接続することにより、お客様は当該アカウントの所有者であるか、または接続する法的権限を有することを表明し、お客様に代わって血糖値および関連メタデータを取得、処理、表示、保存、同期することをStatsKeyに認可します。</li>
              <li><strong class="text-text-primary">第三者としての立場。</strong> StatsKeyは、当社が書面で明示的に別段の表明をしない限り、いかなるCGMプロバイダーとも提携しておらず、後援、推奨、承認、検証を受けておらず、その代理人として行動するものでもありません。プロバイダーが別途の認可、本番アクセス、審査、認証、または契約を要求する場合、関連する連携は当該プロバイダーが許可する範囲でのみ利用できます。プロバイダー、プラットフォーム、規制当局、セキュリティ上の懸念、法的義務、または当社自身のリスク評価により要求もしくは推奨される場合、当社はいつでもCGM機能を制限、停止、または無効化することができます。</li>
              <li><strong class="text-text-primary">第三者の規約。</strong> お客様は、適用される第三者の規約、プライバシーポリシー、製品表示、アカウント規則、共有設定を遵守する必要があります。当社はこれらの規約を管理しておらず、第三者プロバイダーがいかなる連携も引き続き許可、サポート、または提供することを保証できません。</li>
              <li><strong class="text-text-primary">取り消しと接続解除。</strong> お客様は、本アプリケーション内でCGM連携を解除でき、一部のプロバイダーでは、プロバイダー自身のアカウント設定で認可を取り消すこともできます。接続解除または取り消しは、技術的に可能な範囲で今後の同期を停止しますが、すでにStatsKeyにインポートされた血糖記録を自動的に削除するものではありません。それらの記録は引き続き当社のプライバシーポリシーおよびお客様の削除権の対象となります。</li>
              <li><strong class="text-text-primary">遅延と提供状況。</strong> StatsKey内のCGMデータは、遅延、不完全、重複、利用不可、シミュレート、古い、変換済み、誤表示、または製造元自身のデバイス、受信機、アプリケーションに表示されるデータと異なる場合があります。プロバイダーのサービスは、予告なく中断、レート制限、変更、停止、または終了されることがあります。サンドボックスまたはシミュレートされたCGMデータは、臨床的検証、アルゴリズムの学習、本番利用、または医療上の決定に使用してはなりません。</li>
              <li><strong class="text-text-primary">医療または安全に関わる重要な用途での使用禁止。</strong> StatsKeyは、過去の記録、分析、ウェルネスのためのアプリケーションです。リアルタイムの血糖モニター、アラーム、遠隔モニタリングサービス、緊急通知システム、糖尿病治療ツール、または自動インスリン投与の構成要素ではありません。StatsKeyを、低血糖もしくは高血糖の検出、治療、対応、インスリンの計算もしくは投与、薬剤の調整、その他の医療上の決定に使用しないでください。</li>
              <li><strong class="text-text-primary">不正使用の禁止。</strong> アクセス制御の回避、第三者サービスのスクレイピングもしくは過負荷、サービスの完全性への干渉、認可のないCGMデータへのアクセス、法的権限と同意のない他者のモニタリング、CGM製品もしくはサービスの比較もしくはベンチマーク、CGMプロバイダーもしくはその製品に関する虚偽もしくは誤解を招く表明、または臨床、商業、緊急、もしくは規制対象の医療機器目的でのCGM連携の使用のために、StatsKeyを使用してはなりません。</li>
            </ul>
            <p>DexcomおよびDexcom Shareは、米国および/またはその他の国におけるDexcom, Inc.の登録商標または未登録商標です。Abbott、FreeStyle Libre、LibreLinkUpは、Abbottおよびその関連会社の商標です。Nightscoutはオープンソースプロジェクトであり、StatsKeyによって運営されているものではありません。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">13. 免責事項</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              本アプリケーション、ならびにすべてのコンテンツ、機能、連携、出力、データ、レポート、表示、アラート、要約、AIの応答、およびサービスは、明示、黙示、法定、その他を問わず、いかなる種類の保証もなく、「現状有姿」かつ「提供可能な範囲」で提供されます。法律で認められる最大限の範囲で、当社は、商品性、特定目的への適合性、非侵害、権原、平穏な享受、提供可能性、適時性、互換性、正確性の黙示的保証を含むがこれらに限られないすべての保証を否認します。当社は、本アプリケーションが中断されないこと、エラーがないこと、安全であること、利用可能であること、正確であること、完全であること、最新であること、またはウイルスその他の有害な構成要素を含まないことを保証しません。当社は、いかなる栄養推定、AIが生成したコンテンツ、健康に関する洞察、血糖分析、生体相関、レポート、同期された記録、第三者データ、または機能の出力の正確性、完全性、信頼性も保証しません。すべてのデータおよび出力は概算であり、誤りを含む場合があります。
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">14. 責任の制限</h2>
            <p class="p-4 border border-white/[0.08] rounded-lg bg-white/[0.02]">
              適用される法律で認められる最大限の範囲で、StatsKey、その役員、取締役、従業員、請負業者、代理人、サービスプロバイダー、または関連会社は、いかなる場合も、利益、収益、のれん、データ、利用、サブスクリプションの価値、事業機会、健康上の成果、身体的傷害、精神的苦痛、人身傷害、デバイスの故障、見逃されたアラート、見逃された同期、失われた記録、AIの出力への依拠、健康もしくは血糖情報への依拠、機能の不提供、提供の遅延、機能の削除、第三者サービスの障害、その他の無形の損失に対する損害を含むがこれらに限られない、間接的、付随的、特別、結果的、懲罰的、見せしめ的、または加重的損害について、その損害が本アプリケーションの利用または利用不能に起因または関連して生じたものであるか否か、責任の理論（契約、不法行為、過失、厳格責任、製造物責任、保証、法令、その他）を問わず、たとえ当社がそのような損害の可能性について知らされていたとしても、責任を負わないものとします。本アプリケーションに起因または関連するすべての請求に対する当社の総責任額は、(A) 請求の前12か月間にお客様が当社に支払った金額、または (B) 100米ドル（100 USD）のいずれか大きい方を超えないものとします。
            </p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">15. 補償</h2>
            <p>お客様は、(a) 本アプリケーションの利用または依拠、(b) 本規約への違反、(c) 第三者の権利の侵害、(d) 第三者の規約、製品表示、プロバイダー規則、または適用される法律への違反、(e) 健康、血糖、AI、同期、ソーシャル、課金、もしくは連携機能の利用、または (f) お客様による本アプリケーションの利用が第三者に損害を与えたという主張に起因または何らかの形で関連して生じる、あらゆる請求、責任、損害、損失、費用、および経費（合理的な弁護士費用を含む）から、StatsKey、その役員、取締役、従業員、請負業者、代理人、サービスプロバイダー、および関連会社を補償し、防御し、免責することに同意します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">16. 紛争解決と仲裁</h2>
            <p class="mb-3"><strong class="text-text-primary">拘束力のある仲裁。</strong> 本規約または本アプリケーションに起因または関連するあらゆる紛争、請求、または論争は、裁判所ではなく、American Arbitration Association（「AAA」）がそのConsumer Arbitration Rulesに基づいて運営する拘束力のある仲裁によって解決されます。ただし、いずれの当事者も、知的財産に関する事項については裁判所に差止めまたは衡平法上の救済を求めることができます。</p>
            <p class="mb-3"><strong class="text-text-primary">集団訴訟の放棄。</strong> お客様とStatsKeyは、各自が相手方に対する請求を、個人の資格においてのみ提起でき、いかなる集団、併合、または代表訴訟においても原告または集団の構成員として提起できないことに同意します。仲裁人は、複数人の請求を併合することはできず、いかなる形態の代表訴訟または集団手続も主宰することはできません。</p>
            <p><strong class="text-text-primary">オプトアウト。</strong> お客様は、本規約に初めて同意してから30日以内に ryanws@statskeybiometrics.com に書面で通知することにより、この仲裁の合意からオプトアウトできます。オプトアウトした場合、紛争は第18条で指定された裁判所で解決されます。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">17. アカウントの終了</h2>
            <ul class="list-disc pl-5 space-y-2">
              <li>お客様は、本アプリケーションを通じていつでもアカウントを削除できます。</li>
              <li>当社は、本規約への違反、またはその他の理由により、当社の単独の裁量で、予告の有無にかかわらず、いつでもアカウントを停止または終了することができます。</li>
              <li>当社は、保守、更新、その他の運用上の理由でサービスを停止することがあります。</li>
              <li>終了とともに、本アプリケーションを利用するお客様の権利は直ちに消滅します。</li>
              <li>削除されたデータは復元できません。当社は、アカウント削除に起因するデータの損失について責任を負いません。</li>
              <li>第4条、第5条、第6条、第11条、第12条、第13条、第14条、第15条、第16条、第18条は、終了後も存続します。</li>
            </ul>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">18. 準拠法および管轄</h2>
            <p>本規約は、抵触法の規定にかかわらず、米国テキサス州の法律に準拠し、これに従って解釈されます。上記の仲裁条項に従うことを条件として、本規約に起因するいかなる法的措置も、テキサス州に所在する州裁判所または連邦裁判所においてのみ提起されるものとし、お客様はそれらの裁判所の対人管轄に同意します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">19. 不可抗力</h2>
            <p>当社は、天災、自然災害、戦争、テロ、パンデミック、労働争議、政府の措置、規制上の措置、App Store、Google Play、もしくはプラットフォームの措置、停電、インターネットもしくは電気通信の障害、クラウドプロバイダーの停止、決済処理業者の停止、AIプロバイダーの停止、第三者のAPIの変更、CGMプロバイダーの変更、レート制限、セキュリティインシデント、または第三者サービスの停止を含むがこれらに限られない、当社の合理的な制御を超える原因に起因する、いかなる障害、遅延、停止、データの損失、性能の低下、不提供、または提供終了についても責任を負いません。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">20. 可分性</h2>
            <p>本規約のいずれかの条項が無効、違法、または執行不能と判断された場合でも、残りの条項は引き続き完全に有効です。無効な条項は、その本来の意図を保ちつつ、有効かつ執行可能とするために必要な最小限の範囲で修正されます。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">21. 完全合意</h2>
            <p>本規約は、プライバシーポリシー、ならびにApple、Stripe、その他の決済プロバイダーが提示する購入条件とともに、本アプリケーションの利用に関するお客様とStatsKeyとの完全な合意を構成し、機能、ロードマップ項目、時期、価格、連携、または将来の成果物に関するいかなる記述を含め、これまでのすべての合意、了解、約束、表明、表示に優先します。</p>
          </section>

          <section>
            <h2 class="font-display font-semibold text-[17px] text-text-primary mb-3">22. お問い合わせ</h2>
            <p>本規約に関するご質問:</p>
            <p class="mt-2"><strong class="text-text-primary">メール:</strong> <a href="mailto:ryanws@statskeybiometrics.com" class="text-accent hover:underline">ryanws@statskeybiometrics.com</a></p>
          </section>

          <section class="pt-4 border-t border-white/[0.06]">
            <p class="text-text-muted text-[13px]">StatsKeyを利用することにより、お客様は本利用規約および当社の<a href="/privacy" class="text-accent hover:underline">プライバシーポリシー</a>を読み、理解し、これらに拘束されることに同意したものとみなされます。</p>
          </section>
  `,
}

applyI18n({ es, de, ja, pt })
