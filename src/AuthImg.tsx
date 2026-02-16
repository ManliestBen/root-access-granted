import { useEffect, useState } from "react";
import { fetchWithAuth } from "./api/client";

type Props = {
  src: string;
  alt?: string;
  className?: string;
  onError?: () => void;
  [key: string]: unknown;
};

/**
 * Renders an img that loads src via authenticated fetch (for API image URLs).
 */
export default function AuthImg({ src, alt = "", className, onError, ...rest }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!src || src === "") return;
    let revoked = false;
    fetchWithAuth(src)
      .then((blob) => {
        if (!revoked) setBlobUrl(URL.createObjectURL(blob));
      })
      .catch(() => {
        if (!revoked) setBlobUrl(null);
        onError?.();
      });
    return () => {
      revoked = true;
      setBlobUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
    };
  }, [src, onError]);

  if (!src || src === "") return null;
  if (!blobUrl) return <span className={className} style={{ background: "#333", color: "#888", padding: "1rem" }}>Loading…</span>;
  return <img src={blobUrl} alt={alt} className={className} onError={onError} {...rest} />;
}
