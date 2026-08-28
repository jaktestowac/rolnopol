/**
 * Default contents of data/feature-flags.json.
 *
 * This lives here, as code, so that loading the defaults never depends on reading the live
 * data file. data/database-manager.js used to `require("./feature-flags.json")` for them,
 * which turned a truncated or half-written flags file into a SyntaxError at startup: the
 * app could not boot to repair the very file that was broken.
 *
 * JSONDatabase restores these when the file is missing, empty, or unparseable, so this is
 * also the recovery content. Keep it in step with the flags the feature-flags service
 * describes; tests/unit/feature-flags.defaults.test.js fails if the two drift apart.
 */

const PREDEFINED_FEATURE_FLAGS = {
  alertsEnabled: true,
  alertsSeverityFilterEnabled: true,
  alertsAiAssistantEnabled: false,
  celebrationEventsEnabled: false,
  terminalPorkySplitPersonalityEnabled: false,
  profileAvatarUploadEnabled: false,
  rolnopolMapEnabled: true,
  docsSearchEnabled: false,
  docsAdvancedSearchEnabled: false,
  docsAiAssistantEnabled: false,
  registrationStrongPasswordEnabled: false,
  twoFactorAuthEnabled: false,
  contactFormEnabled: true,
  staffFieldsExportEnabled: false,
  financialReportsEnabled: false,
  financialCsvExportEnabled: false,
  financialCommoditiesEnabled: false,
  financialCommoditiesTradingEnabled: false,
  financialCommoditiesMarketDeskEnabled: false,
  prometheusMetricsEnabled: false,
  homeWelcomeVideoEnabled: false,
  homeStatsSectionEnabled: false,
  homeModernRestyleEnabled: false,
  homeInstrumentalityRestyleEnabled: false,
  cookieConsentBannerEnabled: false,
  messengerEnabled: false,
  assistantChatEnabled: false,
  notificationCenterEnabled: false,
  weatherPageEnabled: false,
  weatherWeatherDataExport: false,
  weatherUserInsightsEnabled: false,
  weatherTrendChartEnabled: false,
  weatherLiveStreamEnabled: false,
  personalApiKeysEnabled: false,
  integrationsWebhooksEnabled: false,
  promoAdvertsHomeEnabled: false,
  promoAdvertsAlertsEnabled: false,
  promoAdvertsGeneralAdEnabled: false,
  promoAdvertsBottomBannerEnabled: false,
  petBuddyEnabled: false,
  rolnopolFarmlogEnabled: false,
  rolnopolFarmlogEngagementEnabled: false,
  taskManagerEnabled: false,
  taskLabEnabled: false,
  greenhouseControlRoomEnabled: false,
  farmStayEnabled: false,
  agriAcademyEnabled: false,
  observatoryEnabled: false,
  crewOfficeEnabled: false,
  survivalGameEnabled: true,
};

/** The shape of the file itself, not just the flag map. */
const FEATURE_FLAGS_DEFAULT_DATA = {
  flags: { ...PREDEFINED_FEATURE_FLAGS },
  updatedAt: null,
};

module.exports = {
  PREDEFINED_FEATURE_FLAGS,
  FEATURE_FLAGS_DEFAULT_DATA,
};
