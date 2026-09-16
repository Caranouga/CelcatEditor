import express, { type Express, type Request, type Response } from 'express';
import dotenv from 'dotenv';
import Requester from './libs/Requester.js';
import * as ics from 'ics'
import he from 'he';
import { writeFileSync } from 'fs';

dotenv.config();

type DescriptionResult = {
    type: string | null,
    modules: string[],
    groups: string[],
    room: string | null,
    teachers: string[],
    weeks: number[],
    sites: string[],
    rest: string[],
};

const CELCAT_GROUP = process.env.CELCAT_GROUP || "";
const PORT = process.env.PORT || 3000;
const MONTHS_TO_FETCH = process.env.MONTHS_TO_FETCH ? parseInt(process.env.MONTHS_TO_FETCH) : 1;
const NOT_FOLLOWED_COURSES = process.env.NOT_FOLLOWED_COURSES ? process.env.NOT_FOLLOWED_COURSES.split(',') : [];

const app: Express = express();
const requester = new Requester();

const getMailFromTeacherName = async (teacherName: string): Promise<string | undefined> => {
    const personData = await requester.getPersonData(teacherName);

    return personData.email;
}

const getWeekNumber = (date: Date): number => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / (24 * 60 * 60 * 1000);

    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
}

const parseDescription = (description: string[], modules: string[] = [], sites: string[] = [], eventCategory: string | null = null) => {
    const entries = description.flatMap(value => String(value).split('\n')).map(x => x.trim()).filter(Boolean);

    const result: DescriptionResult = {
        type: null,
        modules: [...modules],
        groups: [],
        room: null,
        teachers: [],
        weeks: [],
        sites: [...sites],
        rest: [],
    };

    const normalize = (str: string) => str.replace(/\s+/g, ' ').trim();

    const isWeek = (str: string) => {
        return /^\d{1,2}(?:\s*-\s*\d{1,2})?(?:\s*,\s*\d{1,2}(?:\s*-\s*\d{1,2})?)*$/.test(str);
    }

    const parseWeek = (str: string) => {
        const weeks: number[] = [];
        const parts = str.split(',').map(x => x.trim());

        for (const part of parts) {
            if (part.includes('-')) {
                const [start, end] = part.split('-').map(x => parseInt(x.trim(), 10));
                if (start == undefined || end == undefined) continue;

                for (let i = start; i <= end; i++) {
                    weeks.push(i);
                }
            } else {
                weeks.push(parseInt(part, 10));
            }
        }

        return weeks;
    }

    const isRoom = (str: string) => {
        const s = str.toLowerCase();

        return (
            // /\bsalle\b/.test(s) ||
            // /\bamphi\b/.test(s) ||
            // /\bamphith[eé]âtre\b/.test(s) ||

            // /\b[a-z]\d{2}\/\s*salle\b/i.test(str) ||
            // /\bb[âa]t(?:iment)?\.?\s*[a-z]\d+/i.test(str) ||
            // /\b[a-z]\d{2,}\b.*\bsalle\b/i.test(str)

            // Salle 303
            /\bsalle(?:\s+informatique)?(?:\s+[a-z]?\d{1,4}|(?:\s+[a-z])?)?\b/i.test(s) ||
            
            // Amphithéâtre / Amphitheatre / Amphi
            /\bamphi(?:th[eé]âtre|theatre)?\b/i.test(s) ||
            
            // Building + room, e.g.:
            // A21/ Salle 303 
            // A21/Salle Informatique A 
            // A22/Amphithéâtre Alfred WEGENER 
            // A29/ Salle 001
            /\b[a-z]\d{2}\s*\/\s*(?:salle|amphi(?:th[eé]âtre|theatre)?)\b/i.test(s) ||
            
            // CREMI - Bât. A28 Salle 103
            /\bb[âa]t(?:iment|\.)?\s*[a-z]\d{2}\s+salle\b/i.test(s)
        )
    }

    const isGroup = (str: string) => {
        const lines = str.split('\n').map(x => x.trim()).filter(Boolean);

        if (!lines.length) return false;

        return lines.every(line =>
            /^[A-Z0-9]+(?:\s+[A-Z0-9]+)*$/.test(line) &&
            /\d/.test(line) &&
            /[A-Z]/.test(line)
        );
    }

    const isTeacher = (str: string) => {
        const value = normalize(str);
        
        const lines = value.split('\n').map(x => x.trim()).filter(Boolean);
        
        if (!lines.length) return false;
        
        const isNameWord = (word: string) => {
            // Accept:
            // MAGONI
            // Sophie
            // Anne-Claire
            // VEGA-ROIATTI
            // Pierre-Andre
            // O'Connor
            return /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-'][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/.test(word);
        };
        
        const looksLikePersonName = (line: string) => {
            const words = line.split(/\s+/);
            
            // If we have less than 2 words or more than 4 words, it's unlikely to be a person's name
            if (words.length < 2 || words.length > 4) return false;
            
            // No numbers, punctuation, slashes, etc.
            if (!words.every(isNameWord)) return false; 
            
            /*
            * Strong signal: 
            *
            * SURNAME Firstname
            * SURNAME Firstname Middlename 
            * 
            * e.g. 
            * MAGONI Damien 
            * LEFTER Horia Victor 
            * HARRISON Anne-Claire
            */
            const first = words[0];
            if(first === undefined) return false;
            const rest = words.slice(1);

            const isUpperCaseWord = (word: string) => word === word.toUpperCase() && /[A-ZÀ-ÖØ-Þ]/.test(word);
            
            const isCapitalizedWord = (word: string) => /^[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]*(?:[-'][A-ZÀ-ÖØ-Þ]?[a-zà-öø-ÿ]+)*$/.test(word); 
            
            if (isUpperCaseWord(first) && rest.every(isCapitalizedWord)) return true; 
            
            /* 
            * Some entries don't have an uppercase surname: 
            * 
            * Delbruel Stéphane 
            * 
            * In that case, accept 2-3 conventional capitalized name words, 
            * but be conservative with 4 words.
            */ 
           if (words.length <= 3 && words.every(isCapitalizedWord)) return true;
           return false;
        }; 
        
        return lines.every(looksLikePersonName);
    };

    const isModule = (str: string) => {
        // E.g. of something that should be recognized as a module:
        // 4TTV316U Ouverture Professionnelle 2
        // 4TTV326U Projet de Fin d'Etudes
        // 4TIN403U Projets technologiques

        const modulePattern = /^[A-Z0-9]{4,10}\s+.+$/;
        return modulePattern.test(normalize(str));
    }

    const isOnlyModuleCode = (str: string) => {
        const value = normalize(str);
        const moduleCodePattern = /^[A-Z0-9]{4,10}$/;
        return moduleCodePattern.test(value);
    }

    const looksLikeType = (str: string) => {
        const knownTypes = [
            'CM',
            'TD',
            'TP',
            'CC',
            'DS',
            'EXAM',
            'EXAMEN',
            'SOUTENANCE',
            'PROJET',
            'TD Machine',
            'TP Machine',
        ];

        return knownTypes.some(type =>
            str.toLowerCase() === type.toLowerCase()
        );
    }

    for(const raw of entries){
        const value = normalize(raw);

        if(!result.type && looksLikeType(value)){
            result.type = value;
            continue;
        }

        // Weeks
        if (isWeek(value)) {
            result.weeks = parseWeek(value);
            continue;
        }

        // Room
        if (!result.room && isRoom(value)) {
            result.room = value;
            continue;
        }

        // Teacher
        if (!result.teachers.includes(value) && isTeacher(value)) {
            result.teachers.push(value);
            continue;
        }

        // Groups
        if (isGroup(value)) {
            result.groups.push(
                ...value
                .split('\n')
                .map(x => x.trim())
                .filter(Boolean)
            );
            continue;
        }

        // Modules
        if ((!result.modules.includes(value) || isOnlyModuleCode(value)) && isModule(value)) {
            result.modules.push(value);
            continue;
        }

        // If we reach this point, the value is not recognized as any of the above
        // so we add it to the rest array
        result.rest.push(value);
    }

    if(!result.type && eventCategory) result.type = eventCategory;

    result.groups = [...new Set(result.groups)];
    result.modules = [...new Set(result.modules)];
    result.sites = [...new Set(result.sites)];
    result.teachers = [...new Set(result.teachers)];
    result.rest = [...new Set(result.rest)];

    // We sort the modules by length in descending order to make sure that the first module is the one with the longest name (which is certainly the one that contains the code and the name)
    result.modules.sort((a, b) => b.length - a.length);

    return result;
}

const generateICS = async () => {
    const date = new Date();
    const startDate = `${date.getFullYear()}-${("0" + (date.getMonth() + 1)).slice(-2)}-01`;
    date.setMonth(date.getMonth() + MONTHS_TO_FETCH);
    const endDate = `${date.getFullYear()}-${("0" + (date.getMonth() + 1)).slice(-2)}-01`;

    const data = await requester.getCalendarData(startDate, endDate, 103, "month", [CELCAT_GROUP], 3);

    const eventsData: ics.EventAttributes[] = [];
    const toDoLaterEvents: { [key: string]: ics.EventAttributes } = {};
    const goodEvents: { [key: string]: ics.EventAttributes } = {};

    for(let i = 0; i < data.length; i++){
        const entry = data[i];
        if(entry === undefined) continue;

        const utcStartDate = new Date(entry.start);
        const utcEndDate = new Date(entry.end);

        if(entry.allDay) {
            utcStartDate.setHours(0);
            utcStartDate.setMinutes(0);
            utcStartDate.setSeconds(0);

            utcEndDate.setHours(23);
            utcEndDate.setMinutes(59);
            utcEndDate.setSeconds(59);
        }

        const descriptionSplitted = he.decode(entry.description).replace(/<br\s*\/?>/gi, "\n").split('\r\n').filter(e => e != '' && e != '\n');

        const parsedDescription = parseDescription(descriptionSplitted, entry.modules == null ? [] : entry.modules, entry.sites == null ? [] : entry.sites, entry.eventCategory == null ? null : entry.eventCategory);

        if(parsedDescription.modules
            .some(
                module => {
                    const moduleCode = module.split(' ')[0];
                    return moduleCode !== undefined && NOT_FOLLOWED_COURSES.includes(moduleCode);
                }
                )
        ) {
            console.log(`Skipping event ${entry.id} because it contains a module in NOT_FOLLOWED_COURSES`);
            continue;
        }

        let isNotGoodTeacher = false;
        let isNotGoodWeek = false;
        let isConcernedEvent = parsedDescription.modules.some(module => module.toLowerCase().includes("4ttv326u"))
        if(isConcernedEvent){
            console.log(`Event ${entry.id} contains module 4TTV326U, checking for teacher and week...`);
            if(!parsedDescription.teachers.some(teacher => teacher.toLowerCase().includes("holloway ruth"))){
                isNotGoodTeacher = true;
            }
            if(![38, 40, 42, 45, 47, 49, 50].includes(getWeekNumber(utcStartDate))){
                isNotGoodWeek = true;
            }
        }

        const teacherMails = parsedDescription.teachers.map(async (t) => t != null ? await getMailFromTeacherName(t) : "");

        // writeFileSync(`./logs/parsedDescription_and_descriptionSplitted_${i}.json`, JSON.stringify({ parsedDescription, descriptionSplitted }, null, 4));
        // writeFileSync(`./logs/parsedDescription_and_descriptionSplitted_${i}.json`, JSON.stringify({ parsedDescription, descriptionSplitted }, null, 4));

        const datas: ics.EventAttributes = {
            start: [utcStartDate.getUTCFullYear(), utcStartDate.getUTCMonth() + 1, utcStartDate.getUTCDate(), utcStartDate.getUTCHours(), utcStartDate.getUTCMinutes()],
            startInputType: 'utc',
            startOutputType: 'utc',
            end: [utcEndDate.getUTCFullYear(), utcEndDate.getUTCMonth() + 1, utcEndDate.getUTCDate(), utcEndDate.getUTCHours(), utcEndDate.getUTCMinutes()],
            endInputType: 'utc',
            endOutputType: 'utc',
            // duration: , // duration ou end
            title: `${parsedDescription.type ?? "Cours"} ${parsedDescription.modules.length === 0 ? "" : `- ${parsedDescription.modules[0]}`} ${isNotGoodTeacher ? "(Mauvais prof)" : ""} ${isNotGoodWeek ? "(Mauvaise semaine)" : ""}`,
            description: `Modules: ${parsedDescription.modules.join(", ")}\nGroupes: ${parsedDescription.groups.join(", ")}\nSalle: ${parsedDescription.room ?? ""}\nProfs.: ${parsedDescription.teachers.join(", ")}\nSemaines: ${parsedDescription.weeks.join(", ")}\nSites: ${parsedDescription.sites.join(", ")}\nReste de la desc.: ${parsedDescription.rest.join(", ")}`,
            location: parsedDescription.room ?? "",
            geo: { lat: 44.80739324228542 , lon: -0.5978698823346441 },
            // url: ,
            status: 'CONFIRMED',
            // organizer: {
            //     name: parsedDescription.teachers[0] ?? "",
            //     email: await teacherMails[0] ?? "",
            //     /*, dir: ,
            //     sentBy:*/
            // },
            // attendees: [{ name: , email: , rsvp: , dir: , partstat: , role: }],
            categories: parsedDescription.type != null ? [parsedDescription.type] : [],
            alarms: [{ action: 'display', description: 'Rappel', trigger: { hours: 1, minutes: 0, before: true } }],
            // productId: ,
            uid: `${entry.id}@celcat.caradev.fr`,
            // method: ,
            // recurrenceRule: ,
            // recurrenceId: ,
            // exclusionDates: ,
            // sequence: ,
            busyStatus: 'BUSY',
            // transp: ,
            // classification: ,
            created: [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()],
            lastModified: [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()],
            calName: `Calendrier ${CELCAT_GROUP}`,
            // htmlContent: 
        };

        if(!isConcernedEvent){
            eventsData.push(datas);
            continue;
        }

        if(isNotGoodTeacher || isNotGoodWeek){
            const bitFlag = (isNotGoodTeacher ? 2 : 0) | (isNotGoodWeek ? 1 : 0);

            toDoLaterEvents[`${utcStartDate.toISOString()}-${utcEndDate.toISOString()}||${datas.uid}||${bitFlag}`] = datas;
            continue;
        }else if(!isNotGoodTeacher && !isNotGoodWeek){
            goodEvents[`${utcStartDate.toISOString()}-${utcEndDate.toISOString()}||${datas.uid}`] = datas;
        }

        eventsData.push(datas);

        //         {
//   id: '-390114417:-1395446921:7:1652193:6',
//   start: '2026-09-28T18:30:00',
//   end: '2026-09-28T20:30:00',
//   allDay: false,
//   description: 'TD\r\n' +
//     '\r\n' +
//     '<br />\r\n' +
//     '\r\n' +
//     '4TTV519U Anglais d&#233;butant Niveau 1 Automne<br />4TTVA42U Anglais d&#233;butant S1\r\n' +
//     '\r\n' +
//     '<br />\r\n' +
//     '\r\n' +
//     'BG302A<br />BG302B<br />BG302C<br />CH301A<br />CH500A<br />CMI OSIA301A<br />CMI OSIA501A<br />EEA501A<br />GC501A<br />IGM501A <br />(18 more...)\r\n' +
//     '\r\n' +
//     '<br />\r\n' +
//     '\r\n' +
//     'A21/ Salle 160<br />A21/ Salle 162\r\n' +
//     '\r\n' +
//     '<br />\r\n' +
//     '\r\n' +
//     '40-43,45-51\r\n' +
//     '\r\n' +
//     '<br />\r\n' +
//     '\r\n' +
//     'groupe 1\r\n',
//   backgroundColor: '#00FF00',
//   textColor: '#000000',
//   department: 'Commun 1 et 2-3 cycles',
//   faculty: 'Université de Bordeaux',
//   eventCategory: 'TD',
//   sites: [ 'Bâtiment A21', 'Bâtiment A21' ],
//   modules: [
//     '4TTVA42U Anglais débutant S1',
//     '4TTV519U Anglais débutant Niveau 1 Automne'
//   ],
//   registerStatus: 0,
//   studentMark: 0,
//   custom1: null,
//   custom2: null,
//   custom3: null
// }
    }

    // Removed all the toDoLaterEvents that are already in goodEvents
    for (const key in toDoLaterEvents) {
        for(const goodKey in goodEvents) {
            console.log(`Comparing ${key} with ${goodKey}`);
            // The two keys are not the same (only start and end date are the same, but the uid is different)
            if (key.split('||')[0] === goodKey.split('||')[0]) {
                console.log(`Removing ${key} from toDoLaterEvents because it is already in goodEvents`);
                delete toDoLaterEvents[key];
                break;
            }
        }
    }

    for (const key in toDoLaterEvents) {
        if (toDoLaterEvents[key] === undefined) continue;

        const [startEnd, uid, bitFlagStr] = key.split('||');
        const bitFlag = parseInt(bitFlagStr, 10);

        // If we have multiple events with the same start and end data, we keep the one with the lowest bitFlag (0 = good, 1 = bad week, 2 = bad teacher, 3 = both bad week and bad teacher)
        
        for (const otherKey in toDoLaterEvents) {
            if (otherKey === key) continue;

            const [otherStartEnd, otherUid, otherBitFlagStr] = otherKey.split('||');
            const otherBitFlag = parseInt(otherBitFlagStr, 10);

            if (startEnd === otherStartEnd) {
                if (otherBitFlag < bitFlag) {
                    console.log(`Removing ${key} from toDoLaterEvents because ${otherKey} has a lower bitFlag`);
                    delete toDoLaterEvents[key];
                    break;
                } else {
                    console.log(`Removing ${otherKey} from toDoLaterEvents because ${key} has a lower bitFlag`);
                    delete toDoLaterEvents[otherKey];
                }
            }
        }
    }

    for (const key in toDoLaterEvents) {
        if (toDoLaterEvents[key] === undefined) continue;

        eventsData.push(toDoLaterEvents[key]);
    }

    const { error, value } = ics.createEvents(eventsData);

    if (error) {
        console.error('Erreur lors de la création du fichier ICS:', error);
        return;
    }

    return value;
};

app.get('/google/ics', async (req: Request, res: Response) => {
    const icsData = await generateICS();

    if (!icsData) {
        res.status(500).send('Erreur lors de la création du fichier ICS');
        return;
    }

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.send(icsData);
});


app.get('/ics', async (req: Request, res: Response) => {
    const value = await generateICS();

    if (!value) {
        res.status(500).send('Erreur lors de la création du fichier ICS');
        return;
    }

    res.setHeader('Content-Type', 'text/calendar');
    res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
    res.send(value);
});


app.listen(PORT, () => {
    console.log(`Serveur proxy démarré sur le port ${PORT}`);
});


// const express = require('express');
// const { createProxyMiddleware, responseInterceptor } = require('http-proxy-middleware');
// const config = require('./config.json');
// const path = require('path');
// const fs = require('fs');

// const TARGET_SERVER = config.targetServer;
// const PORT = config.port;

// const app = express();

// app.use((req, res, next) => {
//     console.log(`Requête interceptée : ${req.method} ${req.originalUrl}`);
//     next();
// });

// function getConfig(){
//     delete require.cache[require.resolve('./config.json')];
//     return require('./config.json');
// }

// app.post('/update-cfg', (req, res) => {
//     let rawData = '';

//     req.on('data', chunk => {
//         rawData += chunk;
//     });

//     req.on('end', () => {
//         try {
//             const data = JSON.parse(rawData);
//             console.log('Requête de mise à jour de la configuration reçue:', data);

//             const { place, duration, hour, nom, prof, grp, salle, avecGrp } = data;

//             // Si les données sont valides, on met à jour la configuration
//             if (place != null && duration != null && hour != null && nom != null && prof != null && grp != null && salle != null && avecGrp != null) {
//                 const config = getConfig();
//                 config.exported = { place, duration, hour, nom, prof, grp, salle, avecGrp };

//                 // Sauvegarde du fichier config.json
//                 fs.writeFile('config.json', JSON.stringify(config, null, 4), (err) => {
//                     if (err) {
//                         console.error('Erreur lors de la sauvegarde de la configuration:', err);
//                         return res.status(500).json({ message: 'Erreur lors de la sauvegarde' });
//                     }
//                     console.log('Configuration sauvegardée');
//                     return res.json({ message: 'Configuration mise à jour' });
//                 });
//             } else {
//                 return res.status(400).json({ message: 'Données invalides' });
//             }
//         } catch (error) {
//             console.error('Erreur lors du parsing du JSON:', error);
//             res.status(400).json({ message: 'Données JSON invalides' });
//         }
//     });
// });

// app.get('/config', (req, res) => {
//     res.sendFile(__dirname + '/index.html');
// });

// app.use(
//     '/',
//     createProxyMiddleware({
//         target: TARGET_SERVER,
//         changeOrigin: true,
//         selfHandleResponse: true,
//         on: {
//             proxyRes: responseInterceptor(async (responseBuffer, proxyRes, req, res) => {
//                 const response = responseBuffer.toString('utf8');

//                 // Write the response to a file (the title of the file is the request URL)
//                 fs.writeFile(path.join(__dirname, 'logs', req.originalUrl.replace(/\//g, '_') + '.json'), response, (err) => {
//                     if (err) {
//                         console.error('Erreur lors de l\'écriture du fichier:', err);
//                     }
//                 });

//                 // On vérifie si la réponse est un JSON
//                 if (response.startsWith('{') || response.startsWith('[')) {
//                     const jsonResponse = JSON.parse(response);
//                     console.log(jsonResponse);
//                     // On vérifie si la réponse contient une liste de cours (ListeCours)
//                     if(jsonResponse.donneesSec && jsonResponse.donneesSec.data && jsonResponse.donneesSec.data.ListeCours) {

                    

//                         // On ajoute un cours fictif
//                         const config = getConfig();
                        
//                         if(!config.exported){
//                             console.warn("Aucune configuration exportée n'a été trouvée.");
//                             return responseBuffer;
//                         }

//                         const today = new Date();
//                         // Set toomorrow's date
//                         today.setDate(today.getDate() + 2);
//                         const todayFormated = `${today.getDate().toString().padStart(2, '0')}/${(today.getMonth() + 1).toString().padStart(2, '0')}/${today.getFullYear()} ${config.exported.hour[0]}:${config.exported.hour[1]}:00`;

//                         console.log(today.getDay());

//                         const toAdd = {
//                             "AvecTafPublie": false,
//                             //"CouleurFond": "#FF0000",
//                             "CouleurFond": "#C0C0C0",
//                             "DateDuCours": {
//                                 "V": todayFormated,
//                                 "_T": 7
//                             },
//                             "G": 0,
//                             "ListeContenus": {
//                                 "V": [
//                                     {
//                                         "G": 16,
//                                         "L": config.exported.nom,
//                                         "N": "83#prout"
//                                     },
//                                     {
//                                         "G": 3,
//                                         "L": config.exported.prof
//                                     },
//                                     {
//                                         "G": 17,
//                                         "L": config.exported.salle,
//                                         "N": "139#prout"
//                                     }
//                                 ],
//                                 "_T": 24
//                             },
//                             "N": "31#prout",
//                             "P": 1135,
//                             "duree": config.exported.duration,
//                             "place": config.exported.place + (today.getDay()-1) * 20
//                         };

//                         if(config.exported.avecGrp){
//                             toAdd.ListeContenus.V.push({
//                                 "G": 2,
//                                 "L": config.exported.grp,
//                                 "N": "64#prout"
//                             });
//                         }

//                         jsonResponse.donneesSec.data.ListeCours.push(toAdd);

//                         // On retourne la réponse modifiée
//                         return JSON.stringify(jsonResponse);
//                     }
                    
//                     // On vérifie si la réponse contient un nom/prénom (Authentification)
//                     if(jsonResponse.donneesSec && jsonResponse.donneesSec.data && jsonResponse.donneesSec.data.libelleUtil && jsonResponse.nom === 'Authentification'){
//                         jsonResponse.donneesSec.data.libelleUtil = "Compte pour la cantine";
//                         return JSON.stringify(jsonResponse);
//                     }
//                 }
//                 return responseBuffer;
//             })
//         }
//     })
// );

// app.listen(PORT, () => {
//     console.log(`Serveur proxy démarré sur le port ${PORT}`);
// });
