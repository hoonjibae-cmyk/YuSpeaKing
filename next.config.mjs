/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [{ source: '/teacher/notices', destination: 'https://learning.yussam.com/teacher/notices', permanent: false }];
  },
  async headers() {
    return [{source:'/teacher/classes/:classId/create',headers:[
      {key:'Content-Security-Policy',value:"frame-ancestors 'self' https://learning.yussam.com"},
      {key:'Referrer-Policy',value:'no-referrer'},
    ]}];
  },
};

export default nextConfig;
