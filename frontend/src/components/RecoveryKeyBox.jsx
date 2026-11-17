import { useState } from 'react';

/** Shows a recovery key big and clear, with a copy button. */
export function RecoveryKeyBox({ value }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard not allowed (e.g. plain http on a phone): the key is on screen to write down
    }
  }

  return (
    <div className="key-box">
      <code>{value}</code>
      {navigator.clipboard && (
        <button type="button" className="btn sm" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      )}
    </div>
  );
}
