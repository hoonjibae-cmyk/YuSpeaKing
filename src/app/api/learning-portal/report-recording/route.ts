import {createAdminClient} from '@/lib/supabase/admin';
import {reportRecordingResponse} from '@/lib/report-recordings';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request:Request){return reportRecordingResponse(request,createAdminClient());}
