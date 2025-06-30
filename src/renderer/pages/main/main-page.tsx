import { Chat } from "../../components/chat";
import styleInline from "./main-page.scss?inline";

export const MainPage = () => {
  return (
    <>
      <style>{styleInline}</style>
      <div className="ai-extension-main-page">
        <Chat />
      </div>
    </>
  );
};
