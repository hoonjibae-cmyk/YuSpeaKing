import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

export async function getWaveNetAccessToken(): Promise<string> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error("Google 키 파일 인증은 사용하지 않습니다.");
  if (process.env.VERCEL_ENV === "production") {
    try {
      const [{ ExternalAccountClient }, { getVercelOidcToken }] = await Promise.all([
        import("google-auth-library"), import("@vercel/oidc"),
      ]);
      const email = process.env.GOOGLE_TTS_SERVICE_ACCOUNT;
      const audience = process.env.GOOGLE_WORKLOAD_IDENTITY_AUDIENCE;
      if (!email || !audience) throw new Error("Google federation configuration unavailable");
      const auth = ExternalAccountClient.fromJSON({
        type: "external_account",
        audience,
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        token_url: "https://sts.googleapis.com/v1/token",
        service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${email}:generateAccessToken`,
        subject_token_supplier: { getSubjectToken: () => getVercelOidcToken() },
      });
      if (!auth) throw new Error("OIDC client unavailable");
      auth.scopes = ["https://www.googleapis.com/auth/cloud-platform"];
      const result = await auth.getAccessToken();
      if (!result.token) throw new Error("Google token unavailable");
      return result.token;
    } catch {
      throw new Error("Google 운영 인증 연결을 확인하세요. 기존 음성을 유지합니다.");
    }
  }
  if (process.env.VERCEL || !process.env.CLOUDSDK_CONFIG || !["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    throw new Error("격리된 사용자 ADC 설정을 확인하세요.");
  }
  try {
    const result = process.platform === "win32"
      ? await exec("cmd.exe", ["/d", "/s", "/c", "gcloud auth application-default print-access-token"], { windowsHide: true, timeout: 30000 })
      : await exec("gcloud", ["auth", "application-default", "print-access-token"], { timeout: 30000 });
    const token = result.stdout.trim();
    if (!token || /\s/.test(token)) throw new Error("ADC unavailable");
    return token;
  } catch {
    throw new Error("사용자 ADC 인증을 확인하세요. 인증 정보는 출력하지 않았습니다.");
  }
}
