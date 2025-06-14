// @ts-ignore
import React from "react";

import "./MainPage.scss";
import { Chat } from "../../components/chat";

import styleInline from "./main-page.scss?inline";

export const MainPage = () => {
  return (
    <>
      <style>{styleInline}</style>
      <div className="extension-ai-main-page">
        <Chat />
      </div>
    </>
  );
};
