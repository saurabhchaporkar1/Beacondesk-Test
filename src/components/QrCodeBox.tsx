import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';

interface QrCodeBoxProps {
  value: string;
  label: string;
}

export const QrCodeBox: React.FC<QrCodeBoxProps> = ({ value, label }) => {
  const [svgMarkup, setSvgMarkup] = useState<string>('');

  useEffect(() => {
    let active = true;
    QRCode.toString(value, {
      type: 'svg',
      margin: 1,
      width: 176,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((svg) => {
        if (active) setSvgMarkup(svg);
      })
      .catch(() => {
        if (active) setSvgMarkup('');
      });

    return () => {
      active = false;
    };
  }, [value]);

  if (!svgMarkup) {
    return (
      <div
        className="w-44 h-44 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center text-xs text-slate-500"
        aria-label={label}
      >
        Generating QR...
      </div>
    );
  }

  return (
    <div
      className="w-44 h-44 rounded-xl border border-slate-200 bg-white p-2 flex items-center justify-center overflow-hidden"
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  );
};
