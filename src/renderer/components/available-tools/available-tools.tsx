import * as React from "react";
import { useApplicationStatusStore } from "../../context/application-context";

export const AvailableTools: React.FC = () => {
  const applicationStatusStore = useApplicationStatusStore();
  const [tools, setTools] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let mounted = true;
    const fetchTools = async () => {
      setLoading(true);
      const result = await applicationStatusStore.getAvailableTools();
      if (mounted) {
        setTools(result);
        setLoading(false);
      }
    };
    fetchTools();
    return () => {
      mounted = false;
    };
  }, [applicationStatusStore]);

  if (loading) {
    return (
      <div
        className="text-input-vertical-list"
        style={{
          maxHeight: "200px",
          overflowY: "auto",
          marginTop: "12px",
          borderRadius: "6px",
          background: "#36393E",
          padding: "8px",
          color: "#fff",
          textAlign: "center",
        }}
      >
        Loading tools...
      </div>
    );
  }

  return (
    <div
      className="text-input-vertical-list"
      style={{
        maxHeight: "200px",
        overflowY: "auto",
        marginTop: "12px",
        borderRadius: "6px",
        background: "#36393E",
        padding: "8px",
      }}
    >
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {tools.map((item, idx) => (
          <li
            key={idx}
            style={{
              padding: "6px 0",
              borderBottom: idx < tools.length - 1 ? "1px solid #00A7A0" : "none",
              display: "flex",
              alignItems: "center",
            }}
          >
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: "50%",
                background: "#00A7A0",
                color: "#fff",
                marginRight: 12,
                fontSize: 18,
              }}
            >
              {item.name ? item.name.charAt(0).toUpperCase() : "?"}
            </span>
            <span>
              <strong>{item.name}</strong> - {item.description}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};
