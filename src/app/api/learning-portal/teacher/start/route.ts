import {NextRequest} from 'next/server';
import {startTeacherLogin} from '@/lib/maeil-teacher-login';
export const runtime='nodejs';
export async function GET(request:NextRequest){return startTeacherLogin(request,'speaking');}
