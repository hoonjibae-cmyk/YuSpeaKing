import {NextRequest} from 'next/server';
import {finishTeacherLogin} from '@/lib/maeil-teacher-login';
export const runtime='nodejs';
export async function GET(request:NextRequest){return finishTeacherLogin(request,'speaking');}
