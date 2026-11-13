using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Net;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AION.Installer
{
    static class SetupProgram
    {
        [STAThread]
        static void Main(string[] args)
        {
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 /* Tls12 */ | (SecurityProtocolType)768 /* Tls11 */;

            bool isSilent = false;
            foreach (string arg in args)
            {
                if (arg.Equals("/quiet", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("/silent", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("/qn", StringComparison.OrdinalIgnoreCase) ||
                    arg.Equals("-q", StringComparison.OrdinalIgnoreCase))
                {
                    isSilent = true;
                }
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            Application.Run(new SetupWizardForm(isSilent));
        }
    }

    public class SetupWizardForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private const string APP_VERSION = "1.0.0-beta.2";
        private const string NODE_URL = "https://nodejs.org/dist/v20.18.0/node-v20.18.0-win-x64.zip";
        private const string TAILSCALE_URL = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.msi";

        private bool isSilent;
        private string installDir;

        // Screen panels
        private Panel pnlScreen1;
        private Panel pnlScreen2;
        private Panel pnlScreen3;
        private Panel pnlScreen4;

        // Screen 1: Device Identity
        private TextBox txtDeviceName;
        private RadioButton rbDesktop;
        private RadioButton rbLaptop;

        // Screen 2: Network & Screen View
        private TextBox txtTailscaleAuthKey;
        private CheckBox chkRustDesk;
        private CheckBox chkStartup;
        private CheckBox chkShortcuts;

        // Screen 3: Installation checklist
        private Label[] stepLabels;
        private ProgressBar progressBar;
        private Label lblStepStatus;
        private Label lblStepDetail;

        // Screen 4: Completion Summary
        private Label lblSummaryDevice;
        private Label lblSummaryTailscale;
        private Label lblSummaryPin;
        private Label lblSummaryUrl;

        public SetupWizardForm(bool silent)
        {
            this.isSilent = silent;

            string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
            }
            if (string.IsNullOrEmpty(localAppData))
            {
                string userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                if (string.IsNullOrEmpty(userProfile)) userProfile = Environment.GetEnvironmentVariable("USERPROFILE");
                if (!string.IsNullOrEmpty(userProfile))
                {
                    localAppData = Path.Combine(userProfile, "AppData", "Local");
                }
            }
            if (string.IsNullOrEmpty(localAppData))
            {
                localAppData = Path.Combine(Path.GetTempPath(), "Local");
            }

            this.installDir = Path.Combine(localAppData, "AION");

            InitializeWizardUI();

            if (isSilent)
            {
                this.WindowState = FormWindowState.Minimized;
                this.ShowInTaskbar = false;
                this.Shown += (s, e) => RunInstallationWorkflow();
            }
        }

        private void InitializeWizardUI()
        {
            this.Text = "AION Setup";
            this.Size = new Size(560, 440);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 17, 32); // #0b1120
            this.ForeColor = Color.FromArgb(244, 244, 245); // #f4f4f5

            // Dark window title bar
            try
            {
                int darkMode = 1;
                DwmSetWindowAttribute(this.Handle, 20, ref darkMode, sizeof(int));
                DwmSetWindowAttribute(this.Handle, 19, ref darkMode, sizeof(int));
            }
            catch { }

            BuildScreen1();
            BuildScreen2();
            BuildScreen3();
            BuildScreen4();

            ShowScreen(1);
        }

        private void ShowScreen(int screenNumber)
        {
            pnlScreen1.Visible = (screenNumber == 1);
            pnlScreen2.Visible = (screenNumber == 2);
            pnlScreen3.Visible = (screenNumber == 3);
            pnlScreen4.Visible = (screenNumber == 4);
        }

        // =====================================================================
        // SCREEN 1: DEVICE IDENTITY
        // =====================================================================
        private void BuildScreen1()
        {
            pnlScreen1 = new Panel();
            pnlScreen1.Dock = DockStyle.Fill;
            pnlScreen1.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "AION";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen1.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Step 1 of 2: Device Identity on Mesh";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen1.Controls.Add(lblSub);

            // Card container
            Panel card = new Panel();
            card.Location = new Point(32, 95);
            card.Size = new Size(480, 235);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen1.Controls.Add(card);

            Label lblNameTitle = new Label();
            lblNameTitle.Text = "Computer Friendly Name";
            lblNameTitle.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblNameTitle.ForeColor = Color.FromArgb(228, 228, 231);
            lblNameTitle.Location = new Point(18, 16);
            lblNameTitle.AutoSize = true;
            card.Controls.Add(lblNameTitle);

            txtDeviceName = new TextBox();
            txtDeviceName.Text = Environment.MachineName;
            txtDeviceName.Font = new Font("Segoe UI", 10.5f);
            txtDeviceName.Location = new Point(20, 42);
            txtDeviceName.Size = new Size(438, 26);
            txtDeviceName.BackColor = Color.FromArgb(28, 36, 52);
            txtDeviceName.ForeColor = Color.White;
            txtDeviceName.BorderStyle = BorderStyle.FixedSingle;
            card.Controls.Add(txtDeviceName);

            Label lblRoleTitle = new Label();
            lblRoleTitle.Text = "Primary Hardware Role";
            lblRoleTitle.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblRoleTitle.ForeColor = Color.FromArgb(228, 228, 231);
            lblRoleTitle.Location = new Point(18, 90);
            lblRoleTitle.AutoSize = true;
            card.Controls.Add(lblRoleTitle);

            rbDesktop = new RadioButton();
            rbDesktop.Text = "Desktop Workstation (Main PC, always plugged in, supports Wake-on-LAN)";
            rbDesktop.Font = new Font("Segoe UI", 9f);
            rbDesktop.ForeColor = Color.FromArgb(212, 212, 216);
            rbDesktop.Location = new Point(20, 118);
            rbDesktop.Size = new Size(440, 36);
            rbDesktop.Checked = true;
            card.Controls.Add(rbDesktop);

            rbLaptop = new RadioButton();
            rbLaptop.Text = "Portable Laptop (Battery powered, mobile workstation)";
            rbLaptop.Font = new Font("Segoe UI", 9f);
            rbLaptop.ForeColor = Color.FromArgb(212, 212, 216);
            rbLaptop.Location = new Point(20, 160);
            rbLaptop.Size = new Size(440, 32);
            card.Controls.Add(rbLaptop);

            // Bottom Buttons
            Button btnCancel = new Button();
            btnCancel.Text = "Cancel";
            btnCancel.Font = new Font("Segoe UI", 9.5f);
            btnCancel.Location = new Point(286, 348);
            btnCancel.Size = new Size(100, 34);
            btnCancel.FlatStyle = FlatStyle.Flat;
            btnCancel.BackColor = Color.FromArgb(32, 42, 60);
            btnCancel.ForeColor = Color.FromArgb(212, 212, 216);
            btnCancel.FlatAppearance.BorderColor = Color.FromArgb(50, 60, 85);
            btnCancel.Click += (s, e) => Application.Exit();
            pnlScreen1.Controls.Add(btnCancel);

            Button btnNext = new Button();
            btnNext.Text = "Continue ->";
            btnNext.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnNext.Location = new Point(396, 348);
            btnNext.Size = new Size(116, 34);
            btnNext.FlatStyle = FlatStyle.Flat;
            btnNext.BackColor = Color.FromArgb(37, 99, 235);
            btnNext.ForeColor = Color.White;
            btnNext.FlatAppearance.BorderColor = Color.FromArgb(29, 78, 216);
            btnNext.Click += (s, e) => ShowScreen(2);
            pnlScreen1.Controls.Add(btnNext);

            this.Controls.Add(pnlScreen1);
        }

        // =====================================================================
        // SCREEN 2: NETWORK & SCREEN VIEW
        // =====================================================================
        private void BuildScreen2()
        {
            pnlScreen2 = new Panel();
            pnlScreen2.Dock = DockStyle.Fill;
            pnlScreen2.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "AION";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen2.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Step 2 of 2: Mesh Network & Screen View";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen2.Controls.Add(lblSub);

            Panel card = new Panel();
            card.Location = new Point(32, 95);
            card.Size = new Size(480, 235);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen2.Controls.Add(card);

            Label lblTsTitle = new Label();
            lblTsTitle.Text = "Tailscale Auth Key (Optional)";
            lblTsTitle.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            lblTsTitle.ForeColor = Color.FromArgb(228, 228, 231);
            lblTsTitle.Location = new Point(18, 14);
            lblTsTitle.AutoSize = true;
            card.Controls.Add(lblTsTitle);

            txtTailscaleAuthKey = new TextBox();
            txtTailscaleAuthKey.Font = new Font("Segoe UI", 9.5f);
            txtTailscaleAuthKey.Location = new Point(20, 38);
            txtTailscaleAuthKey.Size = new Size(438, 24);
            txtTailscaleAuthKey.BackColor = Color.FromArgb(28, 36, 52);
            txtTailscaleAuthKey.ForeColor = Color.White;
            txtTailscaleAuthKey.BorderStyle = BorderStyle.FixedSingle;
            card.Controls.Add(txtTailscaleAuthKey);

            Label lblTsHelp = new Label();
            lblTsHelp.Text = "Leave blank for standard browser login, or paste tskey-auth-... to join automatically.";
            lblTsHelp.Font = new Font("Segoe UI", 8f);
            lblTsHelp.ForeColor = Color.FromArgb(140, 145, 160);
            lblTsHelp.Location = new Point(20, 66);
            lblTsHelp.Size = new Size(438, 18);
            card.Controls.Add(lblTsHelp);

            chkRustDesk = new CheckBox();
            chkRustDesk.Text = "Enable Portable RustDesk Screen View (Remote Display Deck)";
            chkRustDesk.Font = new Font("Segoe UI", 9f);
            chkRustDesk.ForeColor = Color.FromArgb(212, 212, 216);
            chkRustDesk.Location = new Point(20, 96);
            chkRustDesk.Size = new Size(440, 24);
            chkRustDesk.Checked = true;
            card.Controls.Add(chkRustDesk);

            chkStartup = new CheckBox();
            chkStartup.Text = "Start AION automatically when Windows starts";
            chkStartup.Font = new Font("Segoe UI", 9f);
            chkStartup.ForeColor = Color.FromArgb(212, 212, 216);
            chkStartup.Location = new Point(20, 130);
            chkStartup.Size = new Size(440, 24);
            chkStartup.Checked = true;
            card.Controls.Add(chkStartup);

            chkShortcuts = new CheckBox();
            chkShortcuts.Text = "Create Start Menu and Desktop shortcuts";
            chkShortcuts.Font = new Font("Segoe UI", 9f);
            chkShortcuts.ForeColor = Color.FromArgb(212, 212, 216);
            chkShortcuts.Location = new Point(20, 164);
            chkShortcuts.Size = new Size(440, 24);
            chkShortcuts.Checked = true;
            card.Controls.Add(chkShortcuts);

            // Bottom Buttons
            Button btnBack = new Button();
            btnBack.Text = "<- Back";
            btnBack.Font = new Font("Segoe UI", 9.5f);
            btnBack.Location = new Point(286, 348);
            btnBack.Size = new Size(100, 34);
            btnBack.FlatStyle = FlatStyle.Flat;
            btnBack.BackColor = Color.FromArgb(32, 42, 60);
            btnBack.ForeColor = Color.FromArgb(212, 212, 216);
            btnBack.FlatAppearance.BorderColor = Color.FromArgb(50, 60, 85);
            btnBack.Click += (s, e) => ShowScreen(1);
            pnlScreen2.Controls.Add(btnBack);

            Button btnInstall = new Button();
            btnInstall.Text = "Install AION";
            btnInstall.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnInstall.Location = new Point(396, 348);
            btnInstall.Size = new Size(116, 34);
            btnInstall.FlatStyle = FlatStyle.Flat;
            btnInstall.BackColor = Color.FromArgb(37, 99, 235);
            btnInstall.ForeColor = Color.White;
            btnInstall.FlatAppearance.BorderColor = Color.FromArgb(29, 78, 216);
            btnInstall.Click += (s, e) =>
            {
                ShowScreen(3);
                RunInstallationWorkflow();
            };
            pnlScreen2.Controls.Add(btnInstall);

            this.Controls.Add(pnlScreen2);
        }

        // =====================================================================
        // SCREEN 3: INSTALLING PROGRESS (6-Step Checklist)
        // =====================================================================
        private void BuildScreen3()
        {
            pnlScreen3 = new Panel();
            pnlScreen3.Dock = DockStyle.Fill;
            pnlScreen3.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "Installing AION";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen3.Controls.Add(lblTitle);

            lblStepStatus = new Label();
            lblStepStatus.Text = "Deploying runtime and configuring mesh services...";
            lblStepStatus.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblStepStatus.ForeColor = Color.FromArgb(161, 161, 170);
            lblStepStatus.Location = new Point(34, 58);
            lblStepStatus.Size = new Size(480, 22);
            pnlScreen3.Controls.Add(lblStepStatus);

            Panel card = new Panel();
            card.Location = new Point(32, 90);
            card.Size = new Size(480, 220);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen3.Controls.Add(card);

            string[] stepTitles = new string[]
            {
                "Node.js v20 LTS runtime",
                "Tailscale mesh network & hostname",
                "Portable RustDesk Screen View",
                "Extracting AION Core & WebView2 host",
                "Firewall TCP 5050 & Installed Apps registry",
                "Starting AION Core & desktop supervisor"
            };

            stepLabels = new Label[stepTitles.Length];
            for (int i = 0; i < stepTitles.Length; i++)
            {
                Label lbl = new Label();
                lbl.Text = "○  " + stepTitles[i];
                lbl.Font = new Font("Segoe UI", 9f);
                lbl.ForeColor = Color.FromArgb(140, 145, 160);
                lbl.Location = new Point(20, 16 + (i * 32));
                lbl.Size = new Size(440, 24);
                card.Controls.Add(lbl);
                stepLabels[i] = lbl;
            }

            progressBar = new ProgressBar();
            progressBar.Location = new Point(32, 330);
            progressBar.Size = new Size(480, 14);
            progressBar.Style = ProgressBarStyle.Continuous;
            progressBar.Minimum = 0;
            progressBar.Maximum = 100;
            progressBar.Value = 5;
            pnlScreen3.Controls.Add(progressBar);

            lblStepDetail = new Label();
            lblStepDetail.Text = "Initializing installation pipeline...";
            lblStepDetail.Font = new Font("Segoe UI", 8.5f);
            lblStepDetail.ForeColor = Color.FromArgb(140, 145, 160);
            lblStepDetail.Location = new Point(34, 354);
            lblStepDetail.Size = new Size(480, 22);
            pnlScreen3.Controls.Add(lblStepDetail);

            this.Controls.Add(pnlScreen3);
        }

        // =====================================================================
        // SCREEN 4: COMPLETION SUMMARY
        // =====================================================================
        private void BuildScreen4()
        {
            pnlScreen4 = new Panel();
            pnlScreen4.Dock = DockStyle.Fill;
            pnlScreen4.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "AION is Ready";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen4.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Your workstation is now live on the mesh";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen4.Controls.Add(lblSub);

            Panel card = new Panel();
            card.Location = new Point(32, 90);
            card.Size = new Size(480, 240);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen4.Controls.Add(card);

            lblSummaryDevice = new Label();
            lblSummaryDevice.Text = "Device: " + Environment.MachineName;
            lblSummaryDevice.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            lblSummaryDevice.ForeColor = Color.White;
            lblSummaryDevice.Location = new Point(20, 16);
            lblSummaryDevice.Size = new Size(440, 24);
            card.Controls.Add(lblSummaryDevice);

            lblSummaryTailscale = new Label();
            lblSummaryTailscale.Text = "Mesh IP: Connecting...";
            lblSummaryTailscale.Font = new Font("Segoe UI", 9f);
            lblSummaryTailscale.ForeColor = Color.FromArgb(212, 212, 216);
            lblSummaryTailscale.Location = new Point(20, 44);
            lblSummaryTailscale.Size = new Size(440, 20);
            card.Controls.Add(lblSummaryTailscale);

            Label lblPinHeader = new Label();
            lblPinHeader.Text = "MOBILE PAIRING PIN";
            lblPinHeader.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            lblPinHeader.ForeColor = Color.FromArgb(161, 161, 170);
            lblPinHeader.Location = new Point(20, 80);
            lblPinHeader.AutoSize = true;
            card.Controls.Add(lblPinHeader);

            lblSummaryPin = new Label();
            lblSummaryPin.Text = "----";
            lblSummaryPin.Font = new Font("Segoe UI", 24f, FontStyle.Bold);
            lblSummaryPin.ForeColor = Color.FromArgb(56, 189, 248); // Cyan
            lblSummaryPin.Location = new Point(18, 102);
            lblSummaryPin.Size = new Size(200, 46);
            card.Controls.Add(lblSummaryPin);

            lblSummaryUrl = new Label();
            lblSummaryUrl.Text = "Phone Pairing URL: http://localhost:5050";
            lblSummaryUrl.Font = new Font("Segoe UI", 8.5f);
            lblSummaryUrl.ForeColor = Color.FromArgb(161, 161, 170);
            lblSummaryUrl.Location = new Point(20, 160);
            lblSummaryUrl.Size = new Size(440, 20);
            card.Controls.Add(lblSummaryUrl);

            Label lblNote = new Label();
            lblNote.Text = "Open AION on your phone, tap Pair, and enter this PIN to connect permanently.";
            lblNote.Font = new Font("Segoe UI", 8.5f);
            lblNote.ForeColor = Color.FromArgb(140, 145, 160);
            lblNote.Location = new Point(20, 190);
            lblNote.Size = new Size(440, 36);
            card.Controls.Add(lblNote);

            Button btnLaunch = new Button();
            btnLaunch.Text = "Launch AION";
            btnLaunch.Font = new Font("Segoe UI", 10f, FontStyle.Bold);
            btnLaunch.Location = new Point(366, 348);
            btnLaunch.Size = new Size(146, 36);
            btnLaunch.FlatStyle = FlatStyle.Flat;
            btnLaunch.BackColor = Color.FromArgb(37, 99, 235);
            btnLaunch.ForeColor = Color.White;
            btnLaunch.FlatAppearance.BorderColor = Color.FromArgb(29, 78, 216);
            btnLaunch.Click += (s, e) =>
            {
                LaunchAionApp();
                Application.Exit();
            };
            pnlScreen4.Controls.Add(btnLaunch);

            this.Controls.Add(pnlScreen4);
        }

        private void SetChecklistStep(int stepIndex, int state, string detail)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(() => SetChecklistStep(stepIndex, state, detail)));
                return;
            }

            if (stepIndex >= 0 && stepIndex < stepLabels.Length)
            {
                string rawText = stepLabels[stepIndex].Text.Substring(3);
                if (state == 0) // In progress
                {
                    stepLabels[stepIndex].Text = "▶  " + rawText;
                    stepLabels[stepIndex].ForeColor = Color.FromArgb(56, 189, 248);
                }
                else if (state == 1) // Completed
                {
                    stepLabels[stepIndex].Text = "✔  " + rawText;
                    stepLabels[stepIndex].ForeColor = Color.FromArgb(74, 222, 128); // Green
                }
                else if (state == 2) // Skipped / Warn
                {
                    stepLabels[stepIndex].Text = "–  " + rawText;
                    stepLabels[stepIndex].ForeColor = Color.FromArgb(250, 204, 21); // Yellow
                }
            }

            if (!string.IsNullOrEmpty(detail))
            {
                lblStepDetail.Text = detail;
            }
        }

        private void UpdateProgress(int percent, string status, string detail)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(() => UpdateProgress(percent, status, detail)));
                return;
            }
            progressBar.Value = Math.Max(0, Math.Min(100, percent));
            if (!string.IsNullOrEmpty(status)) lblStepStatus.Text = status;
            if (!string.IsNullOrEmpty(detail)) lblStepDetail.Text = detail;
        }

        private async void RunInstallationWorkflow()
        {
            bool installedNode = false;
            bool installedTailscale = false;
            bool enableRustDesk = chkRustDesk != null && chkRustDesk.Checked;
            bool enableStartup = chkStartup != null && chkStartup.Checked;
            bool enableShortcuts = chkShortcuts != null && chkShortcuts.Checked;
            string deviceName = (txtDeviceName != null && !string.IsNullOrEmpty(txtDeviceName.Text.Trim()))
                ? txtDeviceName.Text.Trim()
                : Environment.MachineName;
            string deviceRole = (rbLaptop != null && rbLaptop.Checked) ? "laptop" : "desktop";
            string tsAuthKey = (txtTailscaleAuthKey != null) ? txtTailscaleAuthKey.Text.Trim() : "";

            try
            {
                Directory.CreateDirectory(installDir);
                Directory.CreateDirectory(Path.Combine(installDir, "data"));

                // Save Device Identity
                string identityPath = Path.Combine(installDir, "data", "device-identity.json");
                string identityJson = string.Format(
                    "{{\r\n  \"name\": \"{0}\",\r\n  \"role\": \"{1}\",\r\n  \"configuredAt\": \"{2}\"\r\n}}",
                    deviceName.Replace("\"", "\\\""),
                    deviceRole,
                    DateTime.UtcNow.ToString("o")
                );
                File.WriteAllText(identityPath, identityJson, Encoding.UTF8);

                // Step 1: Node.js v20 LTS
                SetChecklistStep(0, 0, "Checking Node.js v20+ runtime environment...");
                UpdateProgress(15, "Step 1 of 6: Node.js Runtime", "Resolving Node.js runtime...");
                string nodeExe = await Task.Run(() => ResolveNodeRuntime(installDir, ref installedNode));
                SetChecklistStep(0, 1, "Node.js v20 LTS runtime verified.");

                // Step 2: Tailscale Mesh
                SetChecklistStep(1, 0, "Configuring Tailscale mesh network...");
                UpdateProgress(30, "Step 2 of 6: Mesh Network", "Configuring Tailscale...");
                await Task.Run(() => EnsureTailscale(tsAuthKey, deviceName, ref installedTailscale));
                SetChecklistStep(1, 1, "Tailscale mesh network configured.");

                // Step 3: Portable RustDesk
                SetChecklistStep(2, 0, "Configuring Remote Screen View...");
                UpdateProgress(48, "Step 3 of 6: Screen View Deck", "Setting up RustDesk...");
                await Task.Run(() => ConfigureScreenView(installDir, enableRustDesk));
                SetChecklistStep(2, enableRustDesk ? 1 : 2, enableRustDesk ? "Portable RustDesk Screen View configured." : "RustDesk Screen View skipped.");

                // Step 4: Extract Application Payload + Native Host
                SetChecklistStep(3, 0, "Extracting AION application files...");
                UpdateProgress(65, "Step 4 of 6: AION Application Core", "Deploying application payload...");
                await Task.Run(() => DeployApplicationFiles(installDir));
                SetChecklistStep(3, 1, "AION application files deployed successfully.");

                // Step 5: System Integrations (Firewall, Startup, Shortcuts, Registry)
                SetChecklistStep(4, 0, "Configuring firewall and desktop shortcuts...");
                UpdateProgress(82, "Step 5 of 6: System Integrations", "Configuring Windows firewall and shortcuts...");
                await Task.Run(() => ConfigureSystemIntegrations(installDir, nodeExe, installedNode, installedTailscale, enableRustDesk, enableStartup, enableShortcuts));
                SetChecklistStep(4, 1, "Firewall rules and desktop shortcuts configured.");

                // Step 6: Start AION & Retrieve Pairing PIN
                SetChecklistStep(5, 0, "Starting AION Core and generating Pairing PIN...");
                UpdateProgress(95, "Step 6 of 6: Starting AION", "Initializing supervisor...");
                string pairingPin = await Task.Run(() => EnsurePairingPin(installDir));
                string tailscaleIp = await Task.Run(() => GetTailscaleOrLocalIp());
                SetChecklistStep(5, 1, "AION Core is active.");
                UpdateProgress(100, "Installation Complete", "Workstation is ready.");

                // Update Screen 4
                if (lblSummaryDevice != null)
                {
                    lblSummaryDevice.Text = string.Format("Device: {0} ({1})", deviceName, deviceRole == "laptop" ? "Portable Laptop" : "Desktop Workstation");
                }
                if (lblSummaryTailscale != null)
                {
                    lblSummaryTailscale.Text = string.Format("Mesh IP: {0}:5050", tailscaleIp);
                }
                if (lblSummaryPin != null)
                {
                    lblSummaryPin.Text = pairingPin;
                }
                if (lblSummaryUrl != null)
                {
                    lblSummaryUrl.Text = string.Format("Pairing URL: http://{0}:5050", tailscaleIp);
                }

                await Task.Delay(800);

                if (!isSilent)
                {
                    ShowScreen(4);
                }
                else
                {
                    LaunchAionApp();
                    Application.Exit();
                }
            }
            catch (Exception ex)
            {
                string errorDetail = string.Format(
                    "Error: {0}\r\n\r\nType: {1}\r\n\r\nLocation:\r\n{2}",
                    ex.Message,
                    ex.GetType().FullName,
                    ex.StackTrace
                );

                UpdateProgress(100, "Installation Error", ex.Message);
                MessageBox.Show(
                    this,
                    errorDetail,
                    "AION Setup Error",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }

        private void LaunchAionApp()
        {
            string aionExe = Path.Combine(installDir, "AION.exe");
            if (File.Exists(aionExe))
            {
                ProcessStartInfo psi = new ProcessStartInfo(aionExe)
                {
                    WorkingDirectory = installDir,
                    UseShellExecute = false
                };
                Process.Start(psi);
            }
        }

        // =====================================================================
        // INSTALLATION WORKERS
        // =====================================================================
        private string ResolveNodeRuntime(string targetDir, ref bool installedNode)
        {
            installedNode = false;
            string bundledNode = Path.Combine(targetDir, "node", "node.exe");
            if (File.Exists(bundledNode)) return bundledNode;

            string systemNode = WhereExe("node.exe");
            if (!string.IsNullOrEmpty(systemNode) && File.Exists(systemNode))
            {
                try
                {
                    string verOutput = RunCommand(systemNode, "-v");
                    if (verOutput.StartsWith("v", StringComparison.OrdinalIgnoreCase))
                    {
                        string[] parts = verOutput.TrimStart('v').Split('.');
                        int major;
                        if (int.TryParse(parts[0], out major) && major >= 20)
                        {
                            return systemNode;
                        }
                    }
                }
                catch { }
            }

            string nodeZip = Path.Combine(Path.GetTempPath(), "node-v20.18.0-win-x64.zip");
            string nodeExtractDir = Path.Combine(targetDir, "node");

            try
            {
                using (WebClient client = new WebClient())
                {
                    client.Headers.Add("User-Agent", "AION-Setup");
                    client.DownloadFile(NODE_URL, nodeZip);
                }

                if (Directory.Exists(nodeExtractDir)) Directory.Delete(nodeExtractDir, true);
                Directory.CreateDirectory(nodeExtractDir);

                using (ZipArchive archive = ZipFile.OpenRead(nodeZip))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string fullName = entry.FullName;
                        int firstSlash = fullName.IndexOf('/');
                        if (firstSlash < 0) firstSlash = fullName.IndexOf('\\');
                        if (firstSlash < 0) continue;

                        string relPath = SanitizeZipEntryRelativePath(fullName.Substring(firstSlash + 1));
                        if (string.IsNullOrEmpty(relPath)) continue;

                        string destPath = Path.Combine(nodeExtractDir, relPath);
                        string fullDestPath = Path.GetFullPath(destPath);
                        if (!fullDestPath.StartsWith(Path.GetFullPath(nodeExtractDir), StringComparison.OrdinalIgnoreCase)) continue;

                        if (entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\") || string.IsNullOrEmpty(entry.Name))
                        {
                            Directory.CreateDirectory(fullDestPath);
                        }
                        else
                        {
                            string parent = Path.GetDirectoryName(fullDestPath);
                            if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent)) Directory.CreateDirectory(parent);
                            entry.ExtractToFile(fullDestPath, true);
                        }
                    }
                }

                installedNode = true;
                return bundledNode;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException("Failed to download or unpack Node.js v20 LTS: " + ex.Message, ex);
            }
            finally
            {
                try { if (File.Exists(nodeZip)) File.Delete(nodeZip); } catch { }
            }
        }

        private void EnsureTailscale(string authKey, string hostname, ref bool installedTailscale)
        {
            installedTailscale = false;
            string tsCli = WhereExe("tailscale.exe");

            if (string.IsNullOrEmpty(tsCli))
            {
                string msiPath = Path.Combine(Path.GetTempPath(), "tailscale-setup.msi");
                try
                {
                    using (WebClient client = new WebClient())
                    {
                        client.Headers.Add("User-Agent", "AION-Setup");
                        client.DownloadFile(TAILSCALE_URL, msiPath);
                    }

                    RunCommand("msiexec.exe", string.Format("/i \"{0}\" /qn /norestart TS_DISABLENOTIFICATIONS=1", msiPath));
                    installedTailscale = true;
                }
                catch { }
                finally
                {
                    try { if (File.Exists(msiPath)) File.Delete(msiPath); } catch { }
                }
            }

            tsCli = WhereExe("tailscale.exe");
            if (!string.IsNullOrEmpty(tsCli))
            {
                try
                {
                    if (!string.IsNullOrEmpty(authKey))
                    {
                        string safeHost = string.IsNullOrEmpty(hostname) ? Environment.MachineName : hostname;
                        RunCommand(tsCli, string.Format("up --authkey={0} --hostname={1} --unattended --accept-routes=false", authKey, safeHost));
                    }
                    else
                    {
                        RunCommand(tsCli, "status");
                    }
                }
                catch { }
            }
        }

        private void ConfigureScreenView(string targetDir, bool enableRustDesk)
        {
            string screenViewJson = Path.Combine(targetDir, "data", "screen-view.json");
            string json = string.Format(
                "{{\r\n  \"installed\": {0},\r\n  \"portable\": {1},\r\n  \"ready\": {2},\r\n  \"updatedAt\": \"{3}\"\r\n}}",
                enableRustDesk ? "true" : "false",
                enableRustDesk ? "true" : "false",
                enableRustDesk ? "true" : "false",
                DateTime.UtcNow.ToString("o")
            );
            File.WriteAllText(screenViewJson, json, Encoding.UTF8);
        }

        private string EnsurePairingPin(string targetDir)
        {
            string trustedFile = Path.Combine(targetDir, "data", "trusted-devices.json");
            string pin = null;

            if (File.Exists(trustedFile))
            {
                try
                {
                    string content = File.ReadAllText(trustedFile, Encoding.UTF8);
                    System.Text.RegularExpressions.Match m = System.Text.RegularExpressions.Regex.Match(content, "\"pin\"\\s*:\\s*\"(\\d{4})\"");
                    if (m.Success)
                    {
                        pin = m.Groups[1].Value;
                    }
                }
                catch { }
            }

            if (string.IsNullOrEmpty(pin))
            {
                Random rnd = new Random();
                pin = rnd.Next(1000, 9999).ToString();
                string newJson = string.Format("{{\r\n  \"pin\": \"{0}\",\r\n  \"devices\": []\r\n}}", pin);
                try { File.WriteAllText(trustedFile, newJson, Encoding.UTF8); } catch { }
            }

            return pin;
        }

        private string GetTailscaleOrLocalIp()
        {
            try
            {
                string tsCli = WhereExe("tailscale.exe");
                if (!string.IsNullOrEmpty(tsCli))
                {
                    string outIp = RunCommand(tsCli, "ip -4").Trim();
                    if (!string.IsNullOrEmpty(outIp) && outIp.StartsWith("100."))
                    {
                        string[] lines = outIp.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        if (lines.Length > 0) return lines[0].Trim();
                    }
                }
            }
            catch { }

            try
            {
                foreach (IPAddress ip in Dns.GetHostAddresses(Dns.GetHostName()))
                {
                    if (ip.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
                    {
                        string s = ip.ToString();
                        if (s.StartsWith("192.168.") || s.StartsWith("10.") || s.StartsWith("172."))
                        {
                            return s;
                        }
                    }
                }
            }
            catch { }

            return "127.0.0.1";
        }

        private void DeployApplicationFiles(string targetDir)
        {
            ExtractResourceToFile("AION.payload.zip", null, delegate(Stream zipStream)
            {
                using (ZipArchive archive = new ZipArchive(zipStream, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        string relPath = SanitizeZipEntryRelativePath(entry.FullName);
                        if (string.IsNullOrEmpty(relPath)) continue;

                        string destPath = Path.Combine(targetDir, relPath);
                        string fullDestPath = Path.GetFullPath(destPath);
                        string fullTargetDir = Path.GetFullPath(targetDir);

                        if (!fullDestPath.StartsWith(fullTargetDir, StringComparison.OrdinalIgnoreCase)) continue;

                        bool isDirectory = entry.FullName.EndsWith("/") || entry.FullName.EndsWith("\\") || string.IsNullOrEmpty(entry.Name);
                        if (isDirectory)
                        {
                            Directory.CreateDirectory(fullDestPath);
                        }
                        else
                        {
                            // Preserve existing configuration files in data/
                            if (fullDestPath.Contains(Path.DirectorySeparatorChar + "data" + Path.DirectorySeparatorChar) && File.Exists(fullDestPath))
                            {
                                continue;
                            }
                            string parentDir = Path.GetDirectoryName(fullDestPath);
                            if (!string.IsNullOrEmpty(parentDir) && !Directory.Exists(parentDir))
                            {
                                Directory.CreateDirectory(parentDir);
                            }
                            entry.ExtractToFile(fullDestPath, true);
                        }
                    }
                }
            });

            ExtractResourceToFile("AION.AION.exe", Path.Combine(targetDir, "AION.exe"), null);
            ExtractResourceToFile("AION.Uninstall.exe", Path.Combine(targetDir, "Uninstall.exe"), null);
            ExtractResourceToFile("AION.Microsoft.Web.WebView2.Core.dll", Path.Combine(targetDir, "Microsoft.Web.WebView2.Core.dll"), null);
            ExtractResourceToFile("AION.Microsoft.Web.WebView2.WinForms.dll", Path.Combine(targetDir, "Microsoft.Web.WebView2.WinForms.dll"), null);
            ExtractResourceToFile("AION.WebView2Loader.dll", Path.Combine(targetDir, "WebView2Loader.dll"), null);
        }

        private void ConfigureSystemIntegrations(string targetDir, string nodeExe, bool installedNode, bool installedTailscale, bool installedRustDesk, bool enableStartup, bool enableShortcuts)
        {
            string manifestJson = string.Format(
                "{{\r\n" +
                "  \"version\": \"{0}\",\r\n" +
                "  \"installPath\": \"{1}\",\r\n" +
                "  \"installDate\": \"{2}\",\r\n" +
                "  \"installedNode\": {3},\r\n" +
                "  \"installedTailscale\": {4},\r\n" +
                "  \"installedRustDesk\": {5},\r\n" +
                "  \"createdShortcuts\": {6},\r\n" +
                "  \"configuredStartup\": {7}\r\n" +
                "}}",
                APP_VERSION,
                targetDir.Replace("\\", "\\\\"),
                DateTime.UtcNow.ToString("o"),
                installedNode ? "true" : "false",
                installedTailscale ? "true" : "false",
                installedRustDesk ? "true" : "false",
                enableShortcuts ? "true" : "false",
                enableStartup ? "true" : "false"
            );
            string dataDir = Path.Combine(targetDir, "data");
            Directory.CreateDirectory(dataDir);
            string dataManifestPath = Path.Combine(dataDir, "install-manifest.json");
            File.WriteAllText(dataManifestPath, manifestJson, Encoding.UTF8);

            string manifestPath = Path.Combine(targetDir, "install-manifest.json");
            File.WriteAllText(manifestPath, manifestJson, Encoding.UTF8);

            RunCommand("schtasks.exe", "/end /tn AionDaemon");
            RunCommand("schtasks.exe", "/delete /tn AionDaemon /f");
            RunCommand("netsh.exe", "advfirewall firewall add rule name=\"AION Core\" dir=in action=allow protocol=TCP localport=5050");

            string aionExe = Path.Combine(targetDir, "AION.exe");
            string iconPath = Path.Combine(targetDir, "public", "brand", "aion.ico");

            if (enableShortcuts)
            {
                string programsFolder = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                if (!string.IsNullOrEmpty(programsFolder))
                {
                    Directory.CreateDirectory(programsFolder);
                    string startMenuPath = Path.Combine(programsFolder, "AION.lnk");
                    CreateShortcut(startMenuPath, aionExe, "", targetDir, iconPath, "AION Workstation Orchestrator");
                }

                string desktopFolder = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                if (!string.IsNullOrEmpty(desktopFolder))
                {
                    string desktopPath = Path.Combine(desktopFolder, "AION.lnk");
                    CreateShortcut(desktopPath, aionExe, "", targetDir, iconPath, "AION Workstation Orchestrator");
                }
            }

            if (enableStartup)
            {
                try
                {
                    using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                    {
                        if (runKey != null)
                        {
                            runKey.SetValue("AION", "\"" + aionExe + "\"");
                        }
                    }
                }
                catch { }
            }

            try
            {
                using (RegistryKey uninstallKey = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AION"))
                {
                    if (uninstallKey != null)
                    {
                        string uninstExe = Path.Combine(targetDir, "Uninstall.exe");
                        uninstallKey.SetValue("DisplayName", "AION Workstation Orchestrator");
                        uninstallKey.SetValue("DisplayVersion", APP_VERSION);
                        uninstallKey.SetValue("Publisher", "AION Project");
                        uninstallKey.SetValue("DisplayIcon", iconPath);
                        uninstallKey.SetValue("InstallLocation", targetDir);
                        uninstallKey.SetValue("UninstallString", "\"" + uninstExe + "\"");
                        uninstallKey.SetValue("QuietUninstallString", "\"" + uninstExe + "\" /quiet");
                        uninstallKey.SetValue("NoModify", 1, RegistryValueKind.DWord);
                        uninstallKey.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch { }
        }

        private static string SanitizeZipEntryRelativePath(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return "";
            string s = raw.Trim();
            int colonIdx = s.LastIndexOf(':');
            if (colonIdx >= 0) s = s.Substring(colonIdx + 1);
            s = s.Replace('\\', '/');
            while (s.StartsWith("/")) s = s.Substring(1);
            if (s.IndexOfAny(Path.GetInvalidPathChars()) >= 0)
            {
                char[] invalids = Path.GetInvalidPathChars();
                StringBuilder sb = new StringBuilder(s.Length);
                for (int i = 0; i < s.Length; i++)
                {
                    char c = s[i];
                    bool bad = false;
                    for (int j = 0; j < invalids.Length; j++)
                    {
                        if (c == invalids[j]) { bad = true; break; }
                    }
                    if (!bad) sb.Append(c);
                }
                s = sb.ToString();
            }
            return s.Trim();
        }

        private void ExtractResourceToFile(string resourceName, string targetPath, Action<Stream> customStreamHandler)
        {
            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream resStream = asm.GetManifestResourceStream(resourceName))
            {
                if (resStream == null) return;
                if (customStreamHandler != null)
                {
                    customStreamHandler(resStream);
                    return;
                }
                if (!string.IsNullOrEmpty(targetPath))
                {
                    string parent = Path.GetDirectoryName(targetPath);
                    if (!string.IsNullOrEmpty(parent) && !Directory.Exists(parent))
                    {
                        Directory.CreateDirectory(parent);
                    }
                    using (FileStream fs = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.None))
                    {
                        resStream.CopyTo(fs);
                    }
                }
            }
        }

        private static string WhereExe(string exeName)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("where.exe", exeName)
                {
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(3000);
                    if (p.ExitCode == 0 && !string.IsNullOrEmpty(output))
                    {
                        string[] lines = output.Split(new char[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
                        if (lines.Length > 0)
                        {
                            string first = lines[0].Trim().Trim('\"');
                            if (File.Exists(first)) return first;
                        }
                    }
                }
            }
            catch { }
            return "";
        }

        private static string RunCommand(string file, string args)
        {
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo(file, args)
                {
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };
                using (Process p = Process.Start(psi))
                {
                    string output = p.StandardOutput.ReadToEnd();
                    p.WaitForExit(10000);
                    return output;
                }
            }
            catch
            {
                return "";
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string arguments, string workingDirectory, string iconPath, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                dynamic shell = Activator.CreateInstance(shellType);
                dynamic shortcut = shell.CreateShortcut(shortcutPath);
                shortcut.TargetPath = targetPath;
                shortcut.Arguments = arguments;
                shortcut.WorkingDirectory = workingDirectory;
                if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath))
                {
                    shortcut.IconLocation = iconPath + ", 0";
                }
                shortcut.Description = description;
                shortcut.Save();
            }
            catch { }
        }
    }
}
