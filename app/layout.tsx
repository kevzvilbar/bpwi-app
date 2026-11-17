import './globals.css';
import Nav from '@/components/Nav';

export const metadata = {
  title: 'BP Waterworks · Plant Operations Schedule',
  description: 'Plant operations roster and schedule monitoring for BP Waterworks, Inc.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
