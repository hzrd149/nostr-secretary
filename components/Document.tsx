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
        <style>
          {`
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              min-height: 100vh;
              padding: 2rem;
            }

            .container {
              max-width: 600px;
              margin: 0 auto;
              background: white;
              border-radius: 12px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              overflow: hidden;
            }

            .header {
              background: #2d3748;
              color: white;
              padding: 2rem;
              text-align: center;
            }

            .header h1 {
              font-size: 1.75rem;
              margin-bottom: 0.5rem;
            }

            .header p {
              color: #a0aec0;
              font-size: 0.9rem;
            }

            .content {
              padding: 2rem;
            }

            .form-group {
              margin-bottom: 1.5rem;
            }

            label {
              display: block;
              margin-bottom: 0.5rem;
              font-weight: 600;
              color: #2d3748;
            }

            .help-text {
              font-size: 0.8rem;
              color: #718096;
              margin-bottom: 0.5rem;
            }

            input[type="text"], textarea {
              width: 100%;
              padding: 0.75rem;
              border: 2px solid #e2e8f0;
              border-radius: 6px;
              font-size: 1rem;
              transition: border-color 0.2s;
            }

            input[type="text"]:focus, textarea:focus {
              outline: none;
              border-color: #667eea;
              box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }

            textarea {
              resize: vertical;
              min-height: 100px;
              font-family: monospace;
              font-size: 0.9rem;
            }

            .button-group {
              display: flex;
              gap: 1rem;
              margin-top: 2rem;
            }

            button {
              flex: 1;
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 6px;
              font-size: 1rem;
              font-weight: 600;
              cursor: pointer;
              transition: all 0.2s;
            }

            .btn-primary {
              background: #667eea;
              color: white;
            }

            .btn-primary:hover {
              background: #5a67d8;
              transform: translateY(-1px);
            }

            .btn-secondary {
              background: #e2e8f0;
              color: #4a5568;
            }

            .btn-secondary:hover {
              background: #cbd5e0;
            }

            .nav-link {
              display: inline-block;
              margin-top: 1rem;
              color: #667eea;
              text-decoration: none;
              font-weight: 500;
            }

            .nav-link:hover {
              text-decoration: underline;
            }

            .success-message {
              background: #48bb78;
              color: white;
              padding: 1rem;
              border-radius: 6px;
              margin-bottom: 1.5rem;
              display: none;
            }

            .success-message.show {
              display: block;
            }

            /* Home page specific styles */
            .home-container {
              text-align: center;
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 20px 40px rgba(0,0,0,0.1);
              max-width: 500px;
              width: 100%;
              margin: 0 auto;
              margin-top: 50vh;
              transform: translateY(-50%);
            }

            .home-container h1 {
              font-size: 2.5rem;
              color: #2d3748;
              margin-bottom: 1rem;
            }

            .home-container p {
              color: #718096;
              font-size: 1.1rem;
              margin-bottom: 2rem;
            }

            .nav-links {
              display: flex;
              gap: 1rem;
              justify-content: center;
            }

            .nav-links .nav-link {
              display: inline-block;
              padding: 0.75rem 1.5rem;
              background: #667eea;
              color: white;
              text-decoration: none;
              border-radius: 6px;
              font-weight: 600;
              transition: all 0.2s;
              margin: 0;
            }

            .nav-links .nav-link:hover {
              background: #5a67d8;
              transform: translateY(-1px);
              text-decoration: none;
            }

            .nav-links .nav-link.secondary {
              background: #e2e8f0;
              color: #4a5568;
            }

            .nav-links .nav-link.secondary:hover {
              background: #cbd5e0;
            }
          `}
        </style>
      </head>
      <body>{children}</body>
    </html>
  );
}
