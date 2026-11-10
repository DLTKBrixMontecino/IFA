const DRIVE_LETTER_RE = /^([A-Za-z]):\\(.*)$/;
const UNC_RE = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/;

export function toWslPath(windowsOrWslPath: string): string {
  const drive = DRIVE_LETTER_RE.exec(windowsOrWslPath);
  if (drive) {
    const [, letter, rest] = drive;
    return `/mnt/${letter.toLowerCase()}/${rest.replace(/\\/g, "/")}`;
  }
  const unc = UNC_RE.exec(windowsOrWslPath);
  if (unc) {
    // \\server\share\rest -> /mnt/server/rest  (share mounted at /mnt/server via drvfs)
    const [, server, , rest] = unc;
    return `/mnt/${server.toLowerCase()}/${(rest ?? "").replace(/\\/g, "/")}`;
  }
  return windowsOrWslPath;
}

export function toWindowsPath(wslOrWindowsPath: string): string {
  const drive = /^\/mnt\/([a-z])\/(.*)$/.exec(wslOrWindowsPath);
  if (drive) {
    const [, letter, rest] = drive;
    return `${letter.toUpperCase()}:\\${rest.replace(/\//g, "\\")}`;
  }
  return wslOrWindowsPath;
}
