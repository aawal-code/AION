/**
 * AION Internationalization (i18n)
 * Plain-language, human-friendly localization across English (EN), Arabic (AR), and German (DE).
 * Written for everyday users with zero technical jargon.
 */

export const TRANSLATIONS = {
  en: {
    // Navigation
    navDevices: 'Devices',
    navChat: 'Assistant & Chat',
    navSettings: 'Settings',
    sectionWorkspace: 'Workspace',
    sectionPowerDisplay: 'Power & Display',
    tileLock: 'Lock',
    tileScreenOff: 'Screen Off',
    tileSleep: 'Sleep',
    tileShutdown: 'Shut Down',
    allDevicesTitle: 'All Devices',
    allDevicesSubtitle: 'Connected workstations, laptops, and mobile peers',
    wolSectionTitle: 'Wake-on-LAN Status',

    // Station & Status
    brandTitle: 'AION',
    statusConnected: 'Connected',
    statusOperational: 'Running smoothly',
    statusOffline: 'Offline',
    
    // View Titles
    viewDevicesTitle: 'Devices & Controls',
    viewDevicesSubtitle: 'Manage your workstation and connected peer devices.',
    viewChatTitle: 'Personal Assistant',
    viewChatSubtitle: 'Ask anything, draft messages, or control your system.',
    viewSettingsTitle: 'Preferences',
    viewSettingsSubtitle: 'Customize language, appearance, and developer options.',

    // Workstation Card
    myComputer: 'My Computer',
    myComputerDesc: 'This workstation',
    quickActions: 'Quick Actions',
    actionLock: 'Lock Screen',
    actionLockDesc: 'Secure display immediately',
    actionScreenOff: 'Turn Off Screen',
    actionScreenOffDesc: 'Power down monitors',
    actionSleep: 'Sleep Mode',
    actionSleepDesc: 'Save power & suspend',
    actionShutdown: 'Shut Down',
    actionShutdownDesc: 'Power down workstation',
    actionQuit: 'Quit App',
    actionQuitDesc: 'Close a running program',

    // WoL & Extended Controls
    wolBadge: 'WoL Ready',
    wolDisabled: 'WoL Disabled in OS',
    wolFastStartupWarn: 'Fast Startup Blocking',
    btnEnableWol: 'Enable Wake in OS',
    btnWake: 'Wake PC',
    wakeSent: 'Wake magic packet sent to {target}',
    wolEnabledSuccess: 'Wake-on-LAN enabled on network adapter',

    // Running Apps
    runningAppsTitle: 'Running Applications',
    runningAppsSubtitle: 'Active user-facing programs sorted by RAM usage.',
    btnQuitApp: 'Quit',
    noRunningApps: 'No active user applications detected.',

    // Device Management
    deviceSelectorAll: 'All Devices',
    editDeviceTitle: 'Edit Device Details',
    deviceNameLabel: 'Friendly Name',
    deviceTypeLabel: 'Device Type',
    deviceMacLabel: 'MAC Address (for WoL)',
    deviceLanIpLabel: 'Local IP Address',
    deviceTsIpLabel: 'Tailscale Mesh IP',
    deviceSaveBtn: 'Save Changes',
    deviceTypeDesktop: 'Desktop PC',
    deviceTypeLaptop: 'Laptop',
    deviceTypeServer: 'Server',
    deviceTypePhone: 'Smartphone',
    deviceTypeTablet: 'Tablet',

    // Confirmations
    confirmShutdownTitle: 'Shut Down Workstation?',
    confirmShutdownPrompt: 'Are you sure you want to shut down this computer completely?',
    confirmSleepTitle: 'Put Computer to Sleep?',
    confirmSleepPrompt: 'Are you sure you want to put this computer to sleep?',
    
    // Connected Mesh / Sync
    meshTitle: 'Connected Devices',
    meshDesc: 'Encrypted peer synchronization',
    meshStatusSynced: 'Up to date',
    meshNoPeers: 'No other devices paired yet',
    meshFoldersSynced: 'Folders synced',

    // Activity Feed
    activityTitle: 'Recent Activity',
    activityDesc: 'A timeline of recent events and system actions.',
    activityEmpty: 'No activity recorded yet today.',
    activityTimeJustNow: 'Just now',
    activityLockDone: 'Workstation screen was secured',
    activitySleepDone: 'System entered sleep mode',
    activityKillDone: 'Application "{target}" was closed',
    activityChatSent: 'Assistant replied to your request',
    activitySyncChecked: 'Synchronization status refreshed',
    activityUpdateChecked: 'System update check performed',

    // Chat / Assistant
    chatWelcome: 'How can I assist you today?',
    chatWelcomeDesc: 'Type a question, control your computer, or speak into the microphone.',
    chipLock: 'Lock screen',
    chipSleep: 'Put computer to sleep',
    chipSyncStatus: 'How is sync status?',
    chipSystemSummary: 'Summarize workstation state',
    chatThinking: 'Thinking...',
    chatUserYou: 'You',
    chatAssistant: 'Assistant',
    chatError: 'Unable to reach assistant. Check server connection.',
    chatCopy: 'Copy',
    chatCopied: 'Copied!',

    // Command Bar
    commandPlaceholder: 'Ask or command anything...',
    commandSend: 'Send',
    commandMic: 'Voice input',
    micListening: 'Listening... speak now',
    micNotSupported: 'Speech recognition not supported in this browser',

    // Quit App Modal
    modalQuitTitle: 'Quit Running Application',
    modalQuitDesc: 'Enter the name of the application you want to close (e.g., Notepad, Spotify, Chrome):',
    modalQuitPlaceholder: 'Application name (e.g., Spotify)',
    modalCancel: 'Cancel',
    modalConfirm: 'Close App',

    // Settings
    sectionLanguage: 'Language',
    sectionLanguageDesc: 'Choose your preferred language. The layout flips instantly between RTL and LTR.',
    langEn: 'English',
    langAr: 'العربية',
    langDe: 'Deutsch',

    sectionAppearance: 'Appearance',
    sectionAppearanceDesc: 'Select an Apple-inspired theme or customize your own palette.',
    themePresets: 'Theme Presets',
    customColorsTitle: 'Custom Palette Pickers',
    colorBg: 'Background',
    colorSurface: 'Cards & Surfaces',
    colorAccent: 'Accent Tint',
    resetColors: 'Reset to Theme Defaults',

    // Themes
    themeMacosDark: 'macOS Dark',
    themeMacosLight: 'macOS Light',
    themeOledMidnight: 'OLED Midnight',
    themeSpaceGray: 'Space Gray',
    themeSilverBirch: 'Cupertino Silver',
    themeTitaniumSunset: 'Desert Titanium',
    themeAlpineGlacier: 'Alpine Glacier',
    themePacificBlue: 'Pacific Blue',
    themeForestEvergreen: 'Forest Evergreen',
    themeRoyalPurple: 'Deep Violet',

    // Developer Mode
    sectionDeveloper: 'Developer Mode',
    sectionDeveloperDesc: 'When enabled, reveals the live event stream drawer, technical node telemetry, and system update controls. Keeps the main UI 100% clean and human-friendly when disabled.',
    devModeToggle: 'Enable Developer Mode',
    devConsoleTitle: 'Live Event Stream (SSE)',
    devFilterAll: 'All Events',
    devClearLogs: 'Clear Logs',
    devLogsEmpty: 'No log events received yet.',
    devNodeMetaTitle: 'Node Telemetry & Architecture',
    devMetaNodeVersion: 'Node Version',
    devMetaPlatform: 'Platform OS',
    devMetaPort: 'Port',
    devMetaPid: 'Process ID',
    devMetaMemory: 'RAM Footprint',
    devMetaUptime: 'Daemon Uptime',

    // Updates
    devUpdatesTitle: 'System Updates',
    devUpdatesDesc: 'Check GitHub repository for the latest AION release and apply seamlessly.',
    btnCheckUpdates: 'Check for Updates',
    btnApplyUpdate: 'Apply Update',
    updateChecking: 'Checking for updates...',
    updateUpToDate: 'You are on the latest version ({version})',
    updateAvailable: 'New version available: {version}',
    updateError: 'Could not connect to update server',
    updateApplying: 'Applying update... daemon will restart.',

    // Notifications & Toasts
    toastCommandSent: 'Command dispatched',
    toastSettingsSaved: 'Settings saved',
  },

  ar: {
    // Navigation
    navDevices: 'الأجهزة',
    navChat: 'المساعد والمحادثة',
    navSettings: 'الإعدادات',
    sectionWorkspace: 'مساحة العمل',
    sectionPowerDisplay: 'الطاقة والشاشة',
    tileLock: 'قفل',
    tileScreenOff: 'إطفاء الشاشة',
    tileSleep: 'سكون',
    tileShutdown: 'إيقاف التشغيل',
    allDevicesTitle: 'جميع الأجهزة',
    allDevicesSubtitle: 'الأجهزة المتصلة والحواسيب المحمولة والهواتف',
    wolSectionTitle: 'حالة التنبيه عبر الشبكة (WoL)',

    // Station & Status
    brandTitle: 'أيون',
    statusConnected: 'متصل',
    statusOperational: 'يعمل بسلاسة',
    statusOffline: 'غير متصل',
    
    // View Titles
    viewDevicesTitle: 'الأجهزة والتحكم',
    viewDevicesSubtitle: 'إدارة محطة عملك ومزامنة الأجهزة المقترنة.',
    viewChatTitle: 'المساعد الشخصي',
    viewChatSubtitle: 'اطرح أي سؤال، أو أدر مهام حاسوبك بسهولة.',
    viewSettingsTitle: 'التفضيلات',
    viewSettingsSubtitle: 'تخصيص اللغة والمظهر والأدوات المتقدمة.',

    // Workstation Card
    myComputer: 'جهازي الشخصي',
    myComputerDesc: 'محطة العمل الحالية',
    quickActions: 'إجراءات سريعة',
    actionLock: 'قفل الشاشة',
    actionLockDesc: 'تأمين فوري للشاشة',
    actionScreenOff: 'إطفاء الشاشة',
    actionScreenOffDesc: 'إطفاء الشاشات دون سكون',
    actionSleep: 'وضع السكون',
    actionSleepDesc: 'توفير الطاقة وسكون الجهاز',
    actionShutdown: 'إيقاف التشغيل',
    actionShutdownDesc: 'إيقاف تشغيل الحاسوب بالكامل',
    actionQuit: 'إغلاق تطبيق',
    actionQuitDesc: 'إنهاء أحد البرامج قيد التشغيل',

    // WoL & Extended Controls
    wolBadge: 'جاهز للاستيقاظ',
    wolDisabled: 'الاستيقاظ معطل في النظام',
    wolFastStartupWarn: 'بدء التشغيل السريع يعيق الإيقاظ',
    btnEnableWol: 'تفعيل الاستيقاظ في النظام',
    btnWake: 'إيقاظ الجهاز',
    wakeSent: 'تم إرسال إشارة الاستيقاظ إلى {target}',
    wolEnabledSuccess: 'تم تفعيل الاستيقاظ عبر الشبكة بنجاح',

    // Running Apps
    runningAppsTitle: 'البرامج قيد التشغيل',
    runningAppsSubtitle: 'البرامج النشطة حالياً مرتبة حسب استهلاك الذاكرة.',
    btnQuitApp: 'إنهاء',
    noRunningApps: 'لا توجد برامج نشطة حالياً.',

    // Device Management
    deviceSelectorAll: 'جميع الأجهزة',
    editDeviceTitle: 'تعديل بيانات الجهاز',
    deviceNameLabel: 'الاسم المألوف',
    deviceTypeLabel: 'نوع الجهاز',
    deviceMacLabel: 'عنوان MAC (للاستيقاظ عبر الشبكة)',
    deviceLanIpLabel: 'عنوان IP المحلي',
    deviceTsIpLabel: 'عنوان Tailscale',
    deviceSaveBtn: 'حفظ التغييرات',
    deviceTypeDesktop: 'كمبيوتر مكتبي',
    deviceTypeLaptop: 'كمبيوتر محمول',
    deviceTypeServer: 'خادم شبكة',
    deviceTypePhone: 'هاتف ذكي',
    deviceTypeTablet: 'جهاز لوحي',

    // Confirmations
    confirmShutdownTitle: 'إيقاف تشغيل الجهاز؟',
    confirmShutdownPrompt: 'هل أنت متأكد من رغبتك في إيقاف تشغيل الحاسوب بالكامل؟',
    confirmSleepTitle: 'إدخال الجهاز في وضع السكون؟',
    confirmSleepPrompt: 'هل تريد بالتأكيد إدخال هذا الحاسوب في وضع السكون؟',
    
    // Connected Mesh / Sync
    meshTitle: 'الأجهزة المتصلة',
    meshDesc: 'مزامنة مشفرة ومباشرة بين أجهزتك',
    meshStatusSynced: 'مُحدّث بالكامل',
    meshNoPeers: 'لا توجد أجهزة مقترنة حالياً',
    meshFoldersSynced: 'المجلدات المزامنة',

    // Activity Feed
    activityTitle: 'سجل النشاط',
    activityDesc: 'موجز زمني للعمليات والأنشطة الأخيرة.',
    activityEmpty: 'لا يوجد أي نشاط مسجل اليوم.',
    activityTimeJustNow: 'الآن',
    activityLockDone: 'تم قفل شاشة الحاسوب بنجاح',
    activitySleepDone: 'تم إدخال النظام في وضع السكون',
    activityKillDone: 'تم إغلاق التطبيق "{target}"',
    activityChatSent: 'قام المساعد بالرد على طلبك',
    activitySyncChecked: 'تم تحديث حالة المزامنة',
    activityUpdateChecked: 'تم فحص تحديثات النظام',

    // Chat / Assistant
    chatWelcome: 'كيف يمكنني مساعدتك اليوم؟',
    chatWelcomeDesc: 'اكتب سؤالك، أو تحكم بجهازك، أو تحدث عبر الميكروفون.',
    chipLock: 'قفل شاشة جهازي',
    chipSleep: 'وضع الجهاز في السكون',
    chipSyncStatus: 'ما هي حالة المزامنة؟',
    chipSystemSummary: 'لخّص حالة حاسوبي',
    chatThinking: 'جارٍ التفكير...',
    chatUserYou: 'أنت',
    chatAssistant: 'المساعد',
    chatError: 'تعذر الاتصال بالمساعد. يرجى التحقق من الخادم.',
    chatCopy: 'نسخ',
    chatCopied: 'تم النسخ!',

    // Command Bar
    commandPlaceholder: 'اكتب طلباً أو استفساراً...',
    commandSend: 'إرسال',
    commandMic: 'إدخال صوتي',
    micListening: 'جارٍ الاستماع... تفضل بالتحدث',
    micNotSupported: 'التعرف على الصوت غير مدعوم في هذا المتصفح',

    // Quit App Modal
    modalQuitTitle: 'إغلاق تطبيق قيد التشغيل',
    modalQuitDesc: 'اكتب اسم البرنامج المراد إغلاقه (مثل Spotify أو Chrome أو Notepad):',
    modalQuitPlaceholder: 'اسم البرنامج (مثال: Spotify)',
    modalCancel: 'إلغاء',
    modalConfirm: 'إغلاق البرنامج',

    // Settings
    sectionLanguage: 'اللغة',
    sectionLanguageDesc: 'اختر لغتك المفضلة. تنقلب الواجهة فوراً بين اليمين واليسار بسلاسة.',
    langEn: 'English',
    langAr: 'العربية',
    langDe: 'Deutsch',

    sectionAppearance: 'المظهر والتصميم',
    sectionAppearanceDesc: 'اختر أحد أنماط آبل الهادئة أو نسّق ألوانك الخاصة.',
    themePresets: 'الأنماط الجاهزة',
    customColorsTitle: 'تخصيص الألوان المباشر',
    colorBg: 'الخلفية',
    colorSurface: 'البطاقات والأسطح',
    colorAccent: 'لون التمييز',
    resetColors: 'استعادة النمط الافتراضي',

    // Themes
    themeMacosDark: 'داكن كوبرتينو',
    themeMacosLight: 'فاتح استوديو',
    themeOledMidnight: 'منتصف الليل OLED',
    themeSpaceGray: 'رمادي فلكي',
    themeSilverBirch: 'فضي كوبرتينو',
    themeTitaniumSunset: 'تيتانيوم صحراوي',
    themeAlpineGlacier: 'جليدي قطبي',
    themePacificBlue: 'أزرق محيطي',
    themeForestEvergreen: 'أخضر الغابة',
    themeRoyalPurple: 'بنفسجي ملكي',

    // Developer Mode
    sectionDeveloper: 'وضع المطورين',
    sectionDeveloperDesc: 'عند التفعيل، يعرض سجل العمليات المباشر وتفاصيل البيئة وخيارات التحديث. وعند إيقافه تبقى الواجهة بسيطة وودودة 100%.',
    devModeToggle: 'تفعيل وضع المطورين',
    devConsoleTitle: 'سجل العمليات المباشر (SSE)',
    devFilterAll: 'جميع الأحداث',
    devClearLogs: 'مسح السجل',
    devLogsEmpty: 'لم يتم استلام أي أحداث بعد.',
    devNodeMetaTitle: 'معلومات الخادم والبيئة',
    devMetaNodeVersion: 'إصدار Node',
    devMetaPlatform: 'نظام التشغيل',
    devMetaPort: 'المنفذ',
    devMetaPid: 'معرف العملية (PID)',
    devMetaMemory: 'استهلاك الذاكرة',
    devMetaUptime: 'مدة التشغيل',

    // Updates
    devUpdatesTitle: 'تحديثات النظام',
    devUpdatesDesc: 'التحقق من توفر أحدث إصدار وتثبيته بسلاسة.',
    btnCheckUpdates: 'التحقق من التحديثات',
    btnApplyUpdate: 'تثبيت التحديث',
    updateChecking: 'جارٍ التحقق من التحديثات...',
    updateUpToDate: 'نظامك على أحدث إصدار ({version})',
    updateAvailable: 'يتوفر إصدار جديد: {version}',
    updateError: 'تعذر الاتصال بخادم التحديثات',
    updateApplying: 'جارٍ تثبيت التحديث... ستتم إعادة التشغيل.',

    // Notifications & Toasts
    toastCommandSent: 'تم تنفيذ الإجراء بنجاح',
    toastSettingsSaved: 'تم حفظ التفضيلات',
  },

  de: {
    // Navigation
    navDevices: 'Geräte',
    navChat: 'Assistent & Chat',
    navSettings: 'Einstellungen',
    sectionWorkspace: 'Arbeitsbereich',
    sectionPowerDisplay: 'Energie & Anzeige',
    tileLock: 'Sperren',
    tileScreenOff: 'Bildschirm aus',
    tileSleep: 'Ruhezustand',
    tileShutdown: 'Ausschalten',
    allDevicesTitle: 'Alle Geräte',
    allDevicesSubtitle: 'Verbundene Arbeitsstationen, Laptops und Mobilgeräte',
    wolSectionTitle: 'Wake-on-LAN-Status',

    // Station & Status
    brandTitle: 'AION',
    statusConnected: 'Verbunden',
    statusOperational: 'Betriebsbereit',
    statusOffline: 'Offline',
    
    // View Titles
    viewDevicesTitle: 'Geräte & Steuerung',
    viewDevicesSubtitle: 'Verwalten Sie Ihren Computer und gekoppelte Geräte.',
    viewChatTitle: 'Persönlicher Assistent',
    viewChatSubtitle: 'Fragen stellen, Nachrichten formulieren oder System steuern.',
    viewSettingsTitle: 'Einstellungen',
    viewSettingsSubtitle: 'Sprache, Erscheinungsbild und Entwickleroptionen anpassen.',

    // Workstation Card
    myComputer: 'Mein Computer',
    myComputerDesc: 'Lokale Arbeitsstation',
    quickActions: 'Schnellaktionen',
    actionLock: 'Bildschirm sperren',
    actionLockDesc: 'Display sofort sichern',
    actionScreenOff: 'Bildschirm ausschalten',
    actionScreenOffDesc: 'Monitore ausschalten',
    actionSleep: 'Ruhezustand',
    actionSleepDesc: 'Energiesparen & Ruhezustand',
    actionShutdown: 'Herunterfahren',
    actionShutdownDesc: 'Computer ausschalten',
    actionQuit: 'App beenden',
    actionQuitDesc: 'Laufendes Programm schließen',

    // WoL & Extended Controls
    wolBadge: 'WoL bereit',
    wolDisabled: 'WoL im System deaktiviert',
    wolFastStartupWarn: 'Schnellstart blockiert WoL',
    btnEnableWol: 'Wake im System aktivieren',
    btnWake: 'PC aufwecken',
    wakeSent: 'Wake-Signal an {target} gesendet',
    wolEnabledSuccess: 'Wake-on-LAN im Netzwerkadapter aktiviert',

    // Running Apps
    runningAppsTitle: 'Laufende Anwendungen',
    runningAppsSubtitle: 'Aktive Programme sortiert nach RAM-Verbrauch.',
    btnQuitApp: 'Beenden',
    noRunningApps: 'Keine aktiven Anwendungen erkannt.',

    // Device Management
    deviceSelectorAll: 'Alle Geräte',
    editDeviceTitle: 'Gerätedaten bearbeiten',
    deviceNameLabel: 'Gerätename',
    deviceTypeLabel: 'Gerätetyp',
    deviceMacLabel: 'MAC-Adresse (für WoL)',
    deviceLanIpLabel: 'Lokale IP-Adresse',
    deviceTsIpLabel: 'Tailscale IP',
    deviceSaveBtn: 'Speichern',
    deviceTypeDesktop: 'Desktop-PC',
    deviceTypeLaptop: 'Laptop',
    deviceTypeServer: 'Server',
    deviceTypePhone: 'Smartphone',
    deviceTypeTablet: 'Tablet',

    // Confirmations
    confirmShutdownTitle: 'Computer herunterfahren?',
    confirmShutdownPrompt: 'Möchten Sie diesen Computer wirklich vollständig herunterfahren?',
    confirmSleepTitle: 'In Ruhezustand versetzen?',
    confirmSleepPrompt: 'Möchten Sie diesen Computer wirklich in den Ruhezustand versetzen?',
    
    // Connected Mesh / Sync
    meshTitle: 'Verbundene Geräte',
    meshDesc: 'Verschlüsselte Direktsynchronisierung',
    meshStatusSynced: 'Auf dem neuesten Stand',
    meshNoPeers: 'Noch keine Geräte gekoppelt',
    meshFoldersSynced: 'Synchronisierte Ordner',

    // Activity Feed
    activityTitle: 'Letzte Aktivitäten',
    activityDesc: 'Ein chronologischer Überblick der letzten Aktionen.',
    activityEmpty: 'Heute noch keine Aktivitäten vorhanden.',
    activityTimeJustNow: 'Gerade eben',
    activityLockDone: 'Bildschirm wurde gesichert',
    activitySleepDone: 'System ging in den Ruhezustand',
    activityKillDone: 'Anwendung „{target}“ wurde beendet',
    activityChatSent: 'Assistent hat geantwortet',
    activitySyncChecked: 'Synchronisierungsstatus aktualisiert',
    activityUpdateChecked: 'Systemaktualisierung überprüft',

    // Chat / Assistant
    chatWelcome: 'Wie kann ich Ihnen heute helfen?',
    chatWelcomeDesc: 'Geben Sie eine Frage ein, steuern Sie den PC oder sprechen Sie ins Mikrofon.',
    chipLock: 'Bildschirm sperren',
    chipSleep: 'In Ruhezustand versetzen',
    chipSyncStatus: 'Wie ist der Sync-Status?',
    chipSystemSummary: 'Computerstatus zusammenfassen',
    chatThinking: 'Denkt nach...',
    chatUserYou: 'Sie',
    chatAssistant: 'Assistent',
    chatError: 'Assistent nicht erreichbar. Serververbindung prüfen.',
    chatCopy: 'Kopieren',
    chatCopied: 'Kopiert!',

    // Command Bar
    commandPlaceholder: 'Befehl eingeben oder Frage stellen...',
    commandSend: 'Senden',
    commandMic: 'Spracheingabe',
    micListening: 'Höre zu... bitte sprechen',
    micNotSupported: 'Spracherkennung wird in diesem Browser nicht unterstützt',

    // Quit App Modal
    modalQuitTitle: 'Laufende Anwendung beenden',
    modalQuitDesc: 'Geben Sie den Namen des Programms ein (z. B. Notepad, Spotify, Chrome):',
    modalQuitPlaceholder: 'Programmname (z. B. Spotify)',
    modalCancel: 'Abbrechen',
    modalConfirm: 'Beenden',

    // Settings
    sectionLanguage: 'Sprache',
    sectionLanguageDesc: 'Wählen Sie Ihre bevorzugte Sprache. Das Layout passt sich sofort an.',
    langEn: 'English',
    langAr: 'العربية',
    langDe: 'Deutsch',

    sectionAppearance: 'Erscheinungsbild',
    sectionAppearanceDesc: 'Wählen Sie ein Apple-Design oder passen Sie Ihre Farben an.',
    themePresets: 'Farbschemata',
    customColorsTitle: 'Eigene Farbpalette',
    colorBg: 'Hintergrund',
    colorSurface: 'Karten & Oberflächen',
    colorAccent: 'Akzentfarbe',
    resetColors: 'Auf Standard zurücksetzen',

    // Themes
    themeMacosDark: 'macOS Dunkel',
    themeMacosLight: 'macOS Hell',
    themeOledMidnight: 'OLED Mitternacht',
    themeSpaceGray: 'Space Grau',
    themeSilverBirch: 'Cupertino Silber',
    themeTitaniumSunset: 'Wüsten-Titanium',
    themeAlpineGlacier: 'Alpen-Gletscher',
    themePacificBlue: 'Pazifikblau',
    themeForestEvergreen: 'Waldgrün',
    themeRoyalPurple: 'Königsviolett',

    // Developer Mode
    sectionDeveloper: 'Entwicklermodus',
    sectionDeveloperDesc: 'Aktiviert den Live-Event-Stream, technische Telemetriedaten und Update-Steuerung. Bei Deaktivierung bleibt die Benutzeroberfläche 100% sauber und anwenderfreundlich.',
    devModeToggle: 'Entwicklermodus aktivieren',
    devConsoleTitle: 'Live-Ereignis-Stream (SSE)',
    devFilterAll: 'Alle Ereignisse',
    devClearLogs: 'Protokoll leeren',
    devLogsEmpty: 'Noch keine Ereignisse empfangen.',
    devNodeMetaTitle: 'Node-Telemetrie & Architektur',
    devMetaNodeVersion: 'Node-Version',
    devMetaPlatform: 'Betriebssystem',
    devMetaPort: 'Port',
    devMetaPid: 'Prozess-ID (PID)',
    devMetaMemory: 'RAM-Verbrauch',
    devMetaUptime: 'Betriebszeit',

    // Updates
    devUpdatesTitle: 'System-Aktualisierungen',
    devUpdatesDesc: 'Das GitHub-Repository nach Versionen prüfen und nahtlos anwenden.',
    btnCheckUpdates: 'Nach Updates suchen',
    btnApplyUpdate: 'Update installieren',
    updateChecking: 'Suche nach Updates...',
    updateUpToDate: 'Sie verwenden die neueste Version ({version})',
    updateAvailable: 'Neue Version verfügbar: {version}',
    updateError: 'Verbindung zum Update-Server fehlgeschlagen',
    updateApplying: 'Update wird angewendet... Daemon startet neu.',

    // Notifications & Toasts
    toastCommandSent: 'Aktion ausgeführt',
    toastSettingsSaved: 'Einstellungen gespeichert',
  },
};

let currentLang = 'en';

export function getLanguage() {
  return currentLang;
}

export function t(key, params = {}) {
  const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
  let text = dict[key] || TRANSLATIONS.en[key] || key;
  
  if (params && typeof params === 'object') {
    Object.keys(params).forEach((p) => {
      text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
    });
  }
  return text;
}

export function setLanguage(lang) {
  if (!TRANSLATIONS[lang]) lang = 'en';
  currentLang = lang;
  try {
    localStorage.setItem('aion_lang', lang);
  } catch {}

  const isRtl = lang === 'ar';
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? 'rtl' : 'ltr';

  // Dispatch custom event for reactive subscribers
  window.dispatchEvent(new CustomEvent('aion:languagechange', { detail: { lang, isRtl } }));
  updateDomTranslations();
  return currentLang;
}

export function initLanguage() {
  let saved = null;
  try {
    saved = localStorage.getItem('aion_lang');
  } catch {}

  if (!saved) {
    const nav = navigator.language || navigator.userLanguage || 'en';
    if (nav.startsWith('ar')) saved = 'ar';
    else if (nav.startsWith('de')) saved = 'de';
    else saved = 'en';
  }

  setLanguage(saved);
}

export function updateDomTranslations() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) {
      el.textContent = t(key);
    }
  });

  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) {
      el.setAttribute('placeholder', t(key));
    }
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
    }
  });
}
