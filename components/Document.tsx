interface DocumentProps {
  title: string;
  children: any;
}

export default function Document({ title, children }: DocumentProps) {
  return (
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <link rel="stylesheet" href="/layout.css" />
        <link rel="stylesheet" href="/form.css" />
        <link rel="stylesheet" href="/button.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
