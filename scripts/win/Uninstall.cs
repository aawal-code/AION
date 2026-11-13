using System;
using System.IO;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace AION.Installer
{
    static class UninstallProgram
    {
        [STAThread]
        static void Main(string[] args)
        {
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

            Application.Run(new UninstallDialogForm(isSilent));
        }
    }

    public class UninstallDialogForm : Form
    {
        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

        private bool isSilent;
        private string installDir;

        // Manifest states
        private bool manifestInstalledNode = false;
        private bool manifestInstalledTailscale = false;
        private bool manifestInstalledRustDesk = false;

        // Screen Panels
        private Panel pnlScreen1;
        private Panel pnlScreen2;
        private Panel pnlScreen3;

        // Screen 1 Controls
        private CheckBox chkApp;
        private CheckBox chkRustDesk;
        private CheckBox chkTailscale;
        private CheckBox chkNode;

        // Screen 2 Controls
        private Label[] stepLabels;
        private ProgressBar progressBar;
        private Label lblStepDetail;

        public UninstallDialogForm(bool silent)
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

            ReadInstallManifest();
            InitializeUI();

            if (isSilent)
            {
                this.WindowState = FormWindowState.Minimized;
                this.ShowInTaskbar = false;
                this.Shown += (s, e) => ExecuteUninstallWorkflow();
            }
        }

        private void ReadInstallManifest()
        {
            string manifestPath = Path.Combine(installDir, "data", "install-manifest.json");
            if (!File.Exists(manifestPath))
            {
                manifestPath = Path.Combine(installDir, "install-manifest.json");
            }
            if (File.Exists(manifestPath))
            {
                try
                {
                    string content = File.ReadAllText(manifestPath, Encoding.UTF8);
                    if (content.IndexOf("\"installedNode\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                        manifestInstalledNode = true;
                    if (content.IndexOf("\"installedTailscale\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                        manifestInstalledTailscale = true;
                    if (content.IndexOf("\"installedRustDesk\": true", StringComparison.OrdinalIgnoreCase) >= 0)
                        manifestInstalledRustDesk = true;
                }
                catch { }
            }
        }

        private void InitializeUI()
        {
            this.Text = "Uninstall AION";
            this.Size = new Size(560, 440);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(11, 17, 32);
            this.ForeColor = Color.FromArgb(244, 244, 245);

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

            ShowScreen(1);
        }

        private void ShowScreen(int screenNumber)
        {
            pnlScreen1.Visible = (screenNumber == 1);
            pnlScreen2.Visible = (screenNumber == 2);
            pnlScreen3.Visible = (screenNumber == 3);
        }

        // =====================================================================
        // SCREEN 1: COMPONENT SELECTION
        // =====================================================================
        private void BuildScreen1()
        {
            pnlScreen1 = new Panel();
            pnlScreen1.Dock = DockStyle.Fill;
            pnlScreen1.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "Uninstall AION";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen1.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Select components to remove from this computer";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen1.Controls.Add(lblSub);

            Panel card = new Panel();
            card.Location = new Point(32, 95);
            card.Size = new Size(480, 235);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen1.Controls.Add(card);

            chkApp = new CheckBox();
            chkApp.Text = "Remove AION Core application, launcher, and desktop configuration";
            chkApp.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            chkApp.ForeColor = Color.White;
            chkApp.Location = new Point(20, 20);
            chkApp.Size = new Size(440, 24);
            chkApp.Checked = true;
            chkApp.AutoCheck = false; // Required
            card.Controls.Add(chkApp);

            chkRustDesk = new CheckBox();
            chkRustDesk.Text = "Remove Portable RustDesk Screen View Deck";
            chkRustDesk.Font = new Font("Segoe UI", 9f);
            chkRustDesk.ForeColor = manifestInstalledRustDesk ? Color.FromArgb(212, 212, 216) : Color.FromArgb(113, 113, 122);
            chkRustDesk.Location = new Point(20, 56);
            chkRustDesk.Size = new Size(440, 24);
            chkRustDesk.Checked = manifestInstalledRustDesk;
            chkRustDesk.Enabled = manifestInstalledRustDesk;
            card.Controls.Add(chkRustDesk);

            chkNode = new CheckBox();
            chkNode.Text = "Remove bundled Node.js v20 runtime";
            chkNode.Font = new Font("Segoe UI", 9f);
            chkNode.ForeColor = manifestInstalledNode ? Color.FromArgb(212, 212, 216) : Color.FromArgb(113, 113, 122);
            chkNode.Location = new Point(20, 92);
            chkNode.Size = new Size(440, 24);
            chkNode.Checked = manifestInstalledNode;
            chkNode.Enabled = manifestInstalledNode;
            card.Controls.Add(chkNode);

            chkTailscale = new CheckBox();
            chkTailscale.Text = "Remove Tailscale mesh client (installed by AION)";
            chkTailscale.Font = new Font("Segoe UI", 9f);
            chkTailscale.ForeColor = manifestInstalledTailscale ? Color.FromArgb(212, 212, 216) : Color.FromArgb(113, 113, 122);
            chkTailscale.Location = new Point(20, 128);
            chkTailscale.Size = new Size(440, 24);
            chkTailscale.Checked = false; // unchecked by default to preserve mesh
            chkTailscale.Enabled = manifestInstalledTailscale;
            card.Controls.Add(chkTailscale);

            Label lblTsNote = new Label();
            lblTsNote.Text = manifestInstalledTailscale
                ? "Tailscale was installed by AION. Leave unchecked if other apps use it."
                : "Tailscale was pre-existing or installed externally and will not be removed.";
            lblTsNote.Font = new Font("Segoe UI", 8f);
            lblTsNote.ForeColor = Color.FromArgb(140, 145, 160);
            lblTsNote.Location = new Point(38, 156);
            lblTsNote.Size = new Size(420, 32);
            card.Controls.Add(lblTsNote);

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

            Button btnUninstall = new Button();
            btnUninstall.Text = "Uninstall";
            btnUninstall.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnUninstall.Location = new Point(396, 348);
            btnUninstall.Size = new Size(116, 34);
            btnUninstall.FlatStyle = FlatStyle.Flat;
            btnUninstall.BackColor = Color.FromArgb(220, 38, 38); // Danger Red
            btnUninstall.ForeColor = Color.White;
            btnUninstall.FlatAppearance.BorderColor = Color.FromArgb(185, 28, 28);
            btnUninstall.Click += (s, e) =>
            {
                ShowScreen(2);
                ExecuteUninstallWorkflow();
            };
            pnlScreen1.Controls.Add(btnUninstall);

            this.Controls.Add(pnlScreen1);
        }

        // =====================================================================
        // SCREEN 2: PROGRESS
        // =====================================================================
        private void BuildScreen2()
        {
            pnlScreen2 = new Panel();
            pnlScreen2.Dock = DockStyle.Fill;
            pnlScreen2.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "Uninstalling AION";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen2.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "Removing services, shortcuts, and application files...";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen2.Controls.Add(lblSub);

            Panel card = new Panel();
            card.Location = new Point(32, 90);
            card.Size = new Size(480, 220);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen2.Controls.Add(card);

            string[] stepTitles = new string[]
            {
                "Terminating running AION processes & Node Core",
                "Removing Windows Firewall rule (TCP 5050)",
                "Removing Windows Startup registry key",
                "Removing Start Menu and Desktop shortcuts",
                "Removing Windows Installed Apps registry entry",
                "Removing application directories and files"
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
            progressBar.Value = 10;
            pnlScreen2.Controls.Add(progressBar);

            lblStepDetail = new Label();
            lblStepDetail.Text = "Stopping active services...";
            lblStepDetail.Font = new Font("Segoe UI", 8.5f);
            lblStepDetail.ForeColor = Color.FromArgb(140, 145, 160);
            lblStepDetail.Location = new Point(34, 354);
            lblStepDetail.Size = new Size(480, 22);
            pnlScreen2.Controls.Add(lblStepDetail);

            this.Controls.Add(pnlScreen2);
        }

        // =====================================================================
        // SCREEN 3: COMPLETION
        // =====================================================================
        private void BuildScreen3()
        {
            pnlScreen3 = new Panel();
            pnlScreen3.Dock = DockStyle.Fill;
            pnlScreen3.BackColor = Color.FromArgb(11, 17, 32);

            Label lblTitle = new Label();
            lblTitle.Text = "Uninstallation Complete";
            lblTitle.Font = new Font("Segoe UI", 18f, FontStyle.Bold);
            lblTitle.ForeColor = Color.White;
            lblTitle.Location = new Point(32, 24);
            lblTitle.AutoSize = true;
            pnlScreen3.Controls.Add(lblTitle);

            Label lblSub = new Label();
            lblSub.Text = "AION has been removed from this computer";
            lblSub.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
            lblSub.ForeColor = Color.FromArgb(161, 161, 170);
            lblSub.Location = new Point(34, 58);
            lblSub.AutoSize = true;
            pnlScreen3.Controls.Add(lblSub);

            Panel card = new Panel();
            card.Location = new Point(32, 90);
            card.Size = new Size(480, 235);
            card.BackColor = Color.FromArgb(18, 24, 38);
            card.BorderStyle = BorderStyle.FixedSingle;
            pnlScreen3.Controls.Add(card);

            Label lblMsg = new Label();
            lblMsg.Text = "All selected components, shortcuts, and configuration settings have been successfully cleaned up.";
            lblMsg.Font = new Font("Segoe UI", 10f);
            lblMsg.ForeColor = Color.FromArgb(228, 228, 231);
            lblMsg.Location = new Point(20, 24);
            lblMsg.Size = new Size(440, 50);
            card.Controls.Add(lblMsg);

            Label lblDetails = new Label();
            lblDetails.Text = "Thank you for using AION.";
            lblDetails.Font = new Font("Segoe UI", 9f);
            lblDetails.ForeColor = Color.FromArgb(140, 145, 160);
            lblDetails.Location = new Point(20, 84);
            lblDetails.Size = new Size(440, 24);
            card.Controls.Add(lblDetails);

            Button btnClose = new Button();
            btnClose.Text = "Close";
            btnClose.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnClose.Location = new Point(396, 348);
            btnClose.Size = new Size(116, 34);
            btnClose.FlatStyle = FlatStyle.Flat;
            btnClose.BackColor = Color.FromArgb(32, 42, 60);
            btnClose.ForeColor = Color.White;
            btnClose.FlatAppearance.BorderColor = Color.FromArgb(50, 60, 85);
            btnClose.Click += (s, e) =>
            {
                TriggerDelayedSelfDelete();
                Application.Exit();
            };
            pnlScreen3.Controls.Add(btnClose);

            this.Controls.Add(pnlScreen3);
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
                else if (state == 1) // Done
                {
                    stepLabels[stepIndex].Text = "✔  " + rawText;
                    stepLabels[stepIndex].ForeColor = Color.FromArgb(74, 222, 128);
                }
            }

            if (!string.IsNullOrEmpty(detail))
            {
                lblStepDetail.Text = detail;
            }
        }

        private void UpdateProgress(int percent, string detail)
        {
            if (this.InvokeRequired)
            {
                this.BeginInvoke(new Action(() => UpdateProgress(percent, detail)));
                return;
            }
            progressBar.Value = Math.Max(0, Math.Min(100, percent));
            if (!string.IsNullOrEmpty(detail)) lblStepDetail.Text = detail;
        }

        private async void ExecuteUninstallWorkflow()
        {
            bool removeTailscale = chkTailscale != null && chkTailscale.Checked;
            bool removeNode = chkNode != null && chkNode.Checked;
            bool removeRustDesk = chkRustDesk != null && chkRustDesk.Checked;

            try
            {
                // Step 1: Terminate active processes
                SetChecklistStep(0, 0, "Stopping AION.exe and child processes...");
                UpdateProgress(15, "Stopping active processes...");
                await Task.Run(() => KillRunningProcesses());
                SetChecklistStep(0, 1, "Processes stopped.");

                // Step 2: Remove Firewall rule
                SetChecklistStep(1, 0, "Removing firewall rule TCP 5050...");
                UpdateProgress(30, "Removing firewall rules...");
                await Task.Run(() => RunCommand("netsh.exe", "advfirewall firewall delete rule name=\"AION Core\""));
                SetChecklistStep(1, 1, "Firewall rule removed.");

                // Step 3: Remove Windows Startup registry
                SetChecklistStep(2, 0, "Removing Windows Startup key...");
                UpdateProgress(45, "Removing startup registry keys...");
                await Task.Run(() =>
                {
                    try
                    {
                        using (RegistryKey runKey = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
                        {
                            if (runKey != null && runKey.GetValue("AION") != null)
                            {
                                runKey.DeleteValue("AION", false);
                            }
                        }
                    }
                    catch { }
                });
                SetChecklistStep(2, 1, "Startup keys removed.");

                // Step 4: Remove Shortcuts
                SetChecklistStep(3, 0, "Removing desktop and Start Menu shortcuts...");
                UpdateProgress(60, "Removing shortcuts...");
                await Task.Run(() =>
                {
                    string programsFolder = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
                    if (!string.IsNullOrEmpty(programsFolder))
                    {
                        string lnk = Path.Combine(programsFolder, "AION.lnk");
                        try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
                    }

                    string desktopFolder = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
                    if (!string.IsNullOrEmpty(desktopFolder))
                    {
                        string lnk = Path.Combine(desktopFolder, "AION.lnk");
                        try { if (File.Exists(lnk)) File.Delete(lnk); } catch { }
                    }
                });
                SetChecklistStep(3, 1, "Shortcuts removed.");

                // Step 5: Remove Installed Apps Registry
                SetChecklistStep(4, 0, "Removing Installed Apps registry entry...");
                UpdateProgress(75, "Removing uninstall entry...");
                await Task.Run(() =>
                {
                    try
                    {
                        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\AION", false);
                    }
                    catch { }
                });
                SetChecklistStep(4, 1, "Registry cleaned.");

                // Step 6: Remove directories & files
                SetChecklistStep(5, 0, "Cleaning application directories...");
                UpdateProgress(90, "Cleaning application files...");
                await Task.Run(() =>
                {
                    if (removeTailscale)
                    {
                        try { RunCommand("msiexec.exe", "/x {TAILSCALE-MSI-PRODUCT-CODE} /qn /norestart"); } catch { }
                    }

                    if (removeRustDesk)
                    {
                        string rdDir = Path.Combine(installDir, "rustdesk");
                        try { if (Directory.Exists(rdDir)) Directory.Delete(rdDir, true); } catch { }
                    }

                    if (removeNode)
                    {
                        string nodeDir = Path.Combine(installDir, "node");
                        try { if (Directory.Exists(nodeDir)) Directory.Delete(nodeDir, true); } catch { }
                    }

                    // Delete standard application subdirectories
                    string[] subDirs = new string[] { "public", "src", "dist" };
                    foreach (string sub in subDirs)
                    {
                        string p = Path.Combine(installDir, sub);
                        try { if (Directory.Exists(p)) Directory.Delete(p, true); } catch { }
                    }
                });
                SetChecklistStep(5, 1, "Files cleaned.");
                UpdateProgress(100, "Uninstallation completed.");

                await Task.Delay(600);

                if (!isSilent)
                {
                    ShowScreen(3);
                }
                else
                {
                    TriggerDelayedSelfDelete();
                    Application.Exit();
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, "Uninstallation error: " + ex.Message, "Uninstall Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Application.Exit();
            }
        }

        private void KillRunningProcesses()
        {
            string[] procNames = new string[] { "AION", "node", "rustdesk" };
            foreach (string name in procNames)
            {
                try
                {
                    Process[] procs = Process.GetProcessesByName(name);
                    foreach (Process p in procs)
                    {
                        try
                        {
                            string procPath = p.MainModule != null ? p.MainModule.FileName : "";
                            if (!string.IsNullOrEmpty(procPath) && procPath.StartsWith(installDir, StringComparison.OrdinalIgnoreCase))
                            {
                                p.Kill();
                                p.WaitForExit(3000);
                            }
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }

        private void TriggerDelayedSelfDelete()
        {
            try
            {
                // Delayed recursive folder cleanup after process exit
                string cmd = string.Format("/c timeout /t 2 /nobreak >nul & rmdir /s /q \"{0}\"", installDir);
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe", cmd)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };
                Process.Start(psi);
            }
            catch { }
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
    }
}
