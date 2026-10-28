import React from 'react';
import { Redirect } from '@docusaurus/router';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';

export default function Home() {
  const {
    siteConfig: { baseUrl },
  } = useDocusaurusContext();

  // Always append "intro" to baseUrl
  const redirectPath = `${baseUrl}intro`;

  return <Redirect to={redirectPath} />;
}
