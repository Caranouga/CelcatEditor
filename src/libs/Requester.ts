import { JSDOM } from "jsdom";
import { readFileSync, writeFileSync } from "node:fs";

export type CelcatData = {
    id: string;
    start: string;
    end: string;
    allDay: boolean;
    description: string;
    backgroundColor: string;
    textColor: string;
    department: string;
    faculty: string;
    eventCategory: string;
    sites: string[];
    modules: string[];
    registerStatus: number,
    studentMark: number,
    custom1: any, // I've always seen null so I do not know what values it can take
    custom2: any, // I've always seen null so I do not know what values it can take
    custom3: any // I've always seen null so I do not know what values it can take
}

type PersonData = {
    name: string;
    email: string | undefined;
    phone: string | undefined;
};

const personDataCache: { [key: string]: { data: PersonData, timestamp: number } } = {};


export default class Requester {
    constructor() {
        const cacheFilePath = `personDataCache.json`;
        try {
            const cacheFileContent = readFileSync(cacheFilePath, "utf-8");
            const parsedCache = JSON.parse(cacheFileContent);
            for (const key in parsedCache) {
                if (parsedCache.hasOwnProperty(key)) {
                    personDataCache[key] = parsedCache[key];
                }
            }
        } catch (error) {
            console.error(`Error reading cache file ${cacheFilePath}:`, error);
        }
    }

    getCalendarData = async (start: string, end: string, resType: number, calView: string, federationIds: string[], colourScheme: number): Promise<CelcatData[]> => {
        const response = await fetch(`${process.env.CELCAT_URL}/calendar/Home/GetCalendarData`, {
            method: "POST",
            headers: {
                "accept": "application/json, text/javascript, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            body: `start=${start}&end=${end}&resType=${resType}&calView=${calView}&federationIds%5B%5D=${federationIds}&colourScheme=${colourScheme}`
        });

        const data = await response.json();
        return data;
    };

    getPersonData = async (person: string): Promise<PersonData> => {
        if (personDataCache[person] && (Date.now() - personDataCache[person].timestamp < Number(process.env.LDAP_CACHE_DURATION))) {
            return personDataCache[person].data;
        }

        const response = await fetch(`${process.env.LDAP_API}`, {
            method: "POST",
            headers: {
                "accept": "text/html, */*; q=0.01",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            body: `nom=${person}`
        });

        const html = await response.text();

        // html:
        /* 
        <ul  class="contacts-list list-unstyled margin-container-large">           <li class="margin-large hide_pages page_1">
                        <article class="contact-item">
                            <h2 class="contact-item-title">Aubry Clementine</h2>             <ul><li>UFR Pharmacie</li><li>Acides nucléiques : Régulations Naturelles et Artificielles</li></ul><p class="contact-item-line">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                                    <path d="M7.198 6.979h17.604c0.004-0 0.008-0 0.012-0 0.601 0 1.145 0.24 1.544 0.628l-0-0c0.396 0.3830.642 0.919 0.642 1.512 0 0.020-0 0.040-0.001 0.060l0-0.003v0.573l-8.57 5.977c-0.676 0.473-1.516 0.756-2.422 0.756s-1.746-0.283-2.436-0.765l0.014 0.009-8.597-6.032v-0.519c-0-0.004-0-0.009-0-0.014 0-1.206 0.978-2.184 2.184-2.184 0.010 0 0.019 0 0.029 0l-0.001-0zM24.802 25.021h-17.604c-0.008 0-0.018 0-0.027 0-1.198 0-2.17-0.971-2.17-2.17 0-0.010 0-0.019 0-0.029l-0 0.001v-9.962l7.042 4.913c1.104 0.776 2.477 1.241 3.958 1.241s2.853-0.464 3.98-1.255l-0.022 0.015 7.042-4.913v9.962c0 0.001 0 0.002 0 0.003 0 0.593-0.246 1.129-0.641 1.511l-0.001 0.001c-0.404 0.386-0.952 0.625-1.555 0.628h-0zM7.198 27.6h17.604c0.016 0 0.035 0 0.055 0 2.641 0 4.782-2.137 4.79-4.776v-13.648c-0.008-2.64-2.149-4.777-4.79-4.777-0.019 0-0.038 0-0.058 0l0.003-0h-17.604c-0.016-0-0.035-0-0.055-0-2.641 0-4.782 2.137-4.79 4.776v13.648c0.008 2.64 2.149 4.777 4.79 4.777 0.019 0 0.038-0 0.058-0l-0.003 0z"></path>
                                    <path d="M7.198 6.979h17.604c0.004-0 0.008-0 0.012-0 0.601 0 1.145 0.24 1.544 0.628l-0-0c0.396 0.3830.642 0.919 0.642 1.512 0 0.020-0 0.040-0.001 0.060l0-0.003v0.573l-8.57 5.977c-0.676 0.473-1.516 0.756-2.422 0.756s-1.746-0.283-2.436-0.765l0.014 0.009-8.597-6.032v-0.519c-0-0.004-0-0.009-0-0.014 0-1.206 0.978-2.184 2.184-2.184 0.010 0 0.019 0 0.029 0l-0.001-0zM24.802 25.021h-17.604c-0.008 0-0.018 0-0.027 0-1.198 0-2.17-0.971-2.17-2.17 0-0.010 0-0.019 0-0.029l-0 0.001v-9.962l7.042 4.913c1.104 0.776 2.477 1.241 3.958 1.241s2.853-0.464 3.98-1.255l-0.022 0.015 7.042-4.913v9.962c0 0.001 0 0.002 0 0.003 0 0.593-0.246 1.129-0.641 1.511l-0.001 0.001c-0.404 0.386-0.952 0.625-1.555 0.628h-0zM7.198 27.6h17.604c0.016 0 0.035 0 0.055 0 2.641 0 4.782-2.137 4.79-4.776v-13.648c-0.008-2.64-2.149-4.777-4.79-4.777-0.019 0-0.038 0-0.058 0l0.003-0h-17.604c-0.016-0-0.035-0-0.055-0-2.641 0-4.782 2.137-4.79 4.776v13.648c0.008 2.64 2.149 4.777 4.79 4.777 0.019 0 0.038-0 0.058-0l-0.003 0z"></path>
                                </svg>
                               <span class="encoded-email">clementine.aubry%40u-bordeaux.fr</span>
                            </p>
                        </article>
                    </li>           <li class="margin-large hide_pages page_1">
                        <article class="contact-item">
                            <h2 class="contact-item-title">Aubry Clementine</h2><p class="contact-item-line">
                                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                                    <path d="M7.198 6.979h17.604c0.004-0 0.008-0 0.012-0 0.601 0 1.145 0.24 1.544 0.628l-0-0c0.396 0.3830.642 0.919 0.642 1.512 0 0.020-0 0.040-0.001 0.060l0-0.003v0.573l-8.57 5.977c-0.676 0.473-1.516 0.756-2.422 0.756s-1.746-0.283-2.436-0.765l0.014 0.009-8.597-6.032v-0.519c-0-0.004-0-0.009-0-0.014 0-1.206 0.978-2.184 2.184-2.184 0.010 0 0.019 0 0.029 0l-0.001-0zM24.802 25.021h-17.604c-0.008 0-0.018 0-0.027 0-1.198 0-2.17-0.971-2.17-2.17 0-0.010 0-0.019 0-0.029l-0 0.001v-9.962l7.042 4.913c1.104 0.776 2.477 1.241 3.958 1.241s2.853-0.464 3.98-1.255l-0.022 0.015 7.042-4.913v9.962c0 0.001 0 0.002 0 0.003 0 0.593-0.246 1.129-0.641 1.511l-0.001 0.001c-0.404 0.386-0.952 0.625-1.555 0.628h-0zM7.198 27.6h17.604c0.016 0 0.035 0 0.055 0 2.641 0 4.782-2.137 4.79-4.776v-13.648c-0.008-2.64-2.149-4.777-4.79-4.777-0.019 0-0.038 0-0.058 0l0.003-0h-17.604c-0.016-0-0.035-0-0.055-0-2.641 0-4.782 2.137-4.79 4.776v13.648c0.008 2.64 2.149 4.777 4.79 4.777 0.019 0 0.038-0 0.058-0l-0.003 0z"></path>
                                    <path d="M7.198 6.979h17.604c0.004-0 0.008-0 0.012-0 0.601 0 1.145 0.24 1.544 0.628l-0-0c0.396 0.3830.642 0.919 0.642 1.512 0 0.020-0 0.040-0.001 0.060l0-0.003v0.573l-8.57 5.977c-0.676 0.473-1.516 0.756-2.422 0.756s-1.746-0.283-2.436-0.765l0.014 0.009-8.597-6.032v-0.519c-0-0.004-0-0.009-0-0.014 0-1.206 0.978-2.184 2.184-2.184 0.010 0 0.019 0 0.029 0l-0.001-0zM24.802 25.021h-17.604c-0.008 0-0.018 0-0.027 0-1.198 0-2.17-0.971-2.17-2.17 0-0.010 0-0.019 0-0.029l-0 0.001v-9.962l7.042 4.913c1.104 0.776 2.477 1.241 3.958 1.241s2.853-0.464 3.98-1.255l-0.022 0.015 7.042-4.913v9.962c0 0.001 0 0.002 0 0.003 0 0.593-0.246 1.129-0.641 1.511l-0.001 0.001c-0.404 0.386-0.952 0.625-1.555 0.628h-0zM7.198 27.6h17.604c0.016 0 0.035 0 0.055 0 2.641 0 4.782-2.137 4.79-4.776v-13.648c-0.008-2.64-2.149-4.777-4.79-4.777-0.019 0-0.038 0-0.058 0l0.003-0h-17.604c-0.016-0-0.035-0-0.055-0-2.641 0-4.782 2.137-4.79 4.776v13.648c0.008 2.64 2.149 4.777 4.79 4.777 0.019 0 0.038-0 0.058-0l-0.003 0z"></path>
                                </svg>
                               <span class="encoded-email">clementine.aubry.1%40u-bordeaux.fr</span>
                            </p>
                        </article>
                    </li></ul>
                    */

                    
        // Get the email & phone number from the HTML using JSDOM
        const dom = new JSDOM(html);
        const emailElement = dom.window.document.querySelector(".encoded-email");
        const email = emailElement ? decodeURIComponent(emailElement.textContent || "") : undefined;

        const phoneElement = dom.window.document.querySelector(".contact-item-line-text");
        const phone = phoneElement ? phoneElement.textContent || undefined : undefined;

        const personData: PersonData = { name: person, email, phone };
        personDataCache[person] = { data: personData, timestamp: Date.now() };

        writeFileSync(`personDataCache.json`, JSON.stringify(personDataCache, null, 4));

        return personData;
    }
}