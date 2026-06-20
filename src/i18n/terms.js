import { applyI18n } from './legal.js'

// Brazilian Portuguese translation of the Terms of Service. Structure and CSS
// classes mirror the English markup in terms.html exactly; only text changes.
// English remains the authoritative version (see the dated disclaimer line).

const pt = {
  __title: 'Termos de Serviço — StatsKey',
  'lp-title': 'Termos de Serviço',
  'lp-date':
    'Em vigor a partir de: 15 de maio de 2026<span class="block mt-2 italic">Esta tradução para o português é apenas informativa. Em caso de divergência, prevalece a versão original em inglês.</span>',
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
              <li>Integração com o Apple Health, incluindo a importação opcional de registros históricos que você autorizar</li>
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
            <p class="mb-3">Isso se aplica a todos os recursos e serviços do Aplicativo, incluindo, sem limitação, reconhecimento de alimentos por IA, leitura de código de barras ou rótulos, estimativas nutricionais, bancos de dados de nutrientes, metas, relatórios, painéis, chat do Intelligence, planos gerados, insights gerados, exibições de glicose, análise de tendência de glicose, conexões de CGM, Dexcom Share, API da Dexcom, Abbott LibreLinkUp, Nightscout, importação ou exportação do Apple Health, sincronização de registros históricos de saúde, sincronização na nuvem, backups, exportação de dados, Amigos, feeds sociais, mensagens, compartilhamento, assinaturas, cobrança pela App Store, cobrança pela Stripe, registro de treinos, GPS, mapas de rota, clima, notificações, widgets, integrações, recursos da web, e qualquer roadmap, demonstração, captura de tela, declaração de suporte, alegação de marketing, texto da loja de apps, declaração em página de preços ou outra comunicação pública ou privada sobre o StatsKey.</p>
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
              <li>As assinaturas são cobradas pela App Store da Apple e estão sujeitas aos termos e condições da Apple.</li>
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
              <li>Apple HealthKit, incluindo a importação opcional de registros de saúde e de glicose (sujeito aos termos da Apple)</li>
              <li>Login com a Apple e o Google (sujeito aos respectivos termos)</li>
              <li>Firebase / Google Cloud Platform (sujeito aos termos do Google)</li>
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
            <p>Não seremos responsáveis por qualquer falha, atraso, suspensão, perda de dados, desempenho degradado, não entrega ou descontinuação resultante de causas além do nosso controle razoável, incluindo, entre outros, casos fortuitos ou de força maior, desastres naturais, guerra, terrorismo, pandemias, disputas trabalhistas, ações governamentais, ação regulatória, ação da App Store ou da plataforma, falhas de energia, falhas de internet ou telecomunicações, indisponibilidade de provedores de nuvem, indisponibilidade de processadores de pagamento, indisponibilidade de provedores de IA, alterações de API de terceiros, alterações de provedores de CGM, limites de taxa, incidentes de segurança ou interrupções de serviços de terceiros.</p>
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

applyI18n({ pt })
