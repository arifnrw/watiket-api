import { join } from "path";
import { promisify } from "util";
import { writeFile } from "fs";
import * as Sentry from "@sentry/node";

import fs = require('fs');

import {
  Contact as WbotContact,
  Message as WbotMessage,
  MessageAck,
  Client,
  MessageMedia
} from "whatsapp-web.js";

import Contact from "../../models/Contact";
import Ticket from "../../models/Ticket";
import Message from "../../models/Message";

import { getIO } from "../../libs/socket";
import CreateMessageService from "../MessageServices/CreateMessageService";
import { logger } from "../../utils/logger";
import CreateOrUpdateContactService from "../ContactServices/CreateOrUpdateContactService";
import FindOrCreateTicketService from "../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../WhatsappService/ShowWhatsAppService";
import { debounce } from "../../helpers/Debounce";
import UpdateTicketService from "../TicketServices/UpdateTicketService";

/* API WEBHOOK */
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); 
const axios = require('axios');
const mime = require('mime-types');
const app = express();
app.use(cors());
app.use(bodyParser.json());
const WEBHOOK = process.env.WEBHOOK_URL;
const URLAPI = process.env.BACKEND_URL;
const TOKEN = process.env.TOKEN;
let QR, BATTERY, PLUGGED, log;
/* API WEBHOOK */

interface Session extends Client {
  id?: number;
}

const writeFileAsync = promisify(writeFile);

const verifyContact = async (msgContact: WbotContact): Promise<Contact> => {
  const profilePicUrl = await msgContact.getProfilePicUrl();

  const contactData = {
    name: msgContact.name || msgContact.pushname || msgContact.id.user,
    number: msgContact.id.user,
    profilePicUrl,
    isGroup: msgContact.isGroup
  };

  const contact = CreateOrUpdateContactService(contactData);

  return contact;
};

const verifyQuotedMessage = async (
  msg: WbotMessage
): Promise<Message | null> => {
  if (!msg.hasQuotedMsg) return null;

  const wbotQuotedMsg = await msg.getQuotedMessage();

  const quotedMsg = await Message.findOne({
    where: { id: wbotQuotedMsg.id.id }
  });

  if (!quotedMsg) return null;

  return quotedMsg;
};

const verifyMediaMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
): Promise<Message> => {
  const quotedMsg = await verifyQuotedMessage(msg);

  const media = await msg.downloadMedia();

  if (!media) {
    throw new Error("ERR_WAPP_DOWNLOAD_MEDIA");
  }

  if (!media.filename) {
    const ext = media.mimetype.split("/")[1].split(";")[0];
    media.filename = `${new Date().getTime()}.${ext}`;
  }

  try {
    await writeFileAsync(
      join(__dirname, "..", "..", "..", "public", media.filename),
      media.data,
      "base64"
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body || media.filename,
    fromMe: msg.fromMe,
    read: msg.fromMe,
    mediaUrl: media.filename,
    mediaType: media.mimetype.split("/")[0],
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.body || media.filename });
  const newMessage = await CreateMessageService({ messageData });

  return newMessage;
};

const verifyMessage = async (
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  const quotedMsg = await verifyQuotedMessage(msg);

  const messageData = {
    id: msg.id.id,
    ticketId: ticket.id,
    contactId: msg.fromMe ? undefined : contact.id,
    body: msg.body,
    fromMe: msg.fromMe,
    mediaType: msg.type,
    read: msg.fromMe,
    quotedMsgId: quotedMsg?.id
  };

  await ticket.update({ lastMessage: msg.body });
  await CreateMessageService({ messageData });
};

const verifyQueue = async (
  wbot: Session,
  msg: WbotMessage,
  ticket: Ticket,
  contact: Contact
) => {
  const { queues, greetingMessage } = await ShowWhatsAppService(wbot.id!);

  if (queues.length === 1) {
    await UpdateTicketService({
      ticketData: { queueId: queues[0].id },
      ticketId: ticket.id
    });

    return;
  }

  const selectedOption = msg.body[0];

  const choosenQueue = queues[+selectedOption - 1];

  if (choosenQueue) {
    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id },
      ticketId: ticket.id
    });

    const body = `\u200e${choosenQueue.greetingMessage}`;

    const sentMessage = await wbot.sendMessage(`${contact.number}@c.us`, body);

    await verifyMessage(sentMessage, ticket, contact);
  } else {
    let options = "";

    queues.forEach((queue, index) => {
      options += `*${index + 1}* - ${queue.name}\n`;
    });

    const body = `\u200e${greetingMessage}\n${options}`;

    const debouncedSentMessage = debounce(
      async () => {
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@c.us`,
          body
        );
        verifyMessage(sentMessage, ticket, contact);
      },
      3000,
      ticket.id
    );

    debouncedSentMessage();
  }
};

const isValidMsg = (msg: WbotMessage): boolean => {
  if (msg.from === "status@broadcast") return false;
  if (
    msg.type === "chat" ||
    msg.type === "audio" ||
    msg.type === "ptt" ||
    msg.type === "video" ||
    msg.type === "image" ||
    msg.type === "document" ||
    msg.type === "vcard" ||
    msg.type === "sticker"
  )
    return true;
  return false;
};

const handleMessage = async (
  msg: WbotMessage,
  wbot: Session
): Promise<void> => {
  if (!isValidMsg(msg)) {
    return;
  }

  try {
    let msgContact: WbotContact;
    let groupContact: Contact | undefined;

    if (msg.fromMe) {
      // messages sent automatically by wbot have a special character in front of it
      // if so, this message was already been stored in database;
      if (/\u200e/.test(msg.body[0])) return;

      // media messages sent from me from cell phone, first comes with "hasMedia = false" and type = "image/ptt/etc"
      // in this case, return and let this message be handled by "media_uploaded" event, when it will have "hasMedia = true"

      if (!msg.hasMedia && msg.type !== "chat" && msg.type !== "vcard") return;

      msgContact = await wbot.getContactById(msg.to);
    } else {
      msgContact = await msg.getContact();
    }

    const chat = await msg.getChat();

    if (chat.isGroup) {
      let msgGroupContact;

      if (msg.fromMe) {
        msgGroupContact = await wbot.getContactById(msg.to);
      } else {
        msgGroupContact = await wbot.getContactById(msg.from);
      }

      groupContact = await verifyContact(msgGroupContact);
    }

    const unreadMessages = msg.fromMe ? 0 : chat.unreadCount;

    const contact = await verifyContact(msgContact);
    const ticket = await FindOrCreateTicketService(
      contact,
      wbot.id!,
      unreadMessages,
      groupContact
    );

    if (msg.hasMedia) {
      await verifyMediaMessage(msg, ticket, contact);
    } else {
      await verifyMessage(msg, ticket, contact);
    }

    const whatsapp = await ShowWhatsAppService(wbot.id!);

    if (
      !ticket.queue &&
      !chat.isGroup &&
      !msg.fromMe &&
      !ticket.userId &&
      whatsapp.queues.length >= 1
    ) {
      await verifyQueue(wbot, msg, ticket, contact);
    }
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling whatsapp message: Err: ${err}`);
  }
};

const handleMsgAck = async (msg: WbotMessage, ack: MessageAck) => {
  await new Promise(r => setTimeout(r, 500));

  const io = getIO();

  try {
    const messageToUpdate = await Message.findByPk(msg.id.id, {
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"]
        }
      ]
    });
    if (!messageToUpdate) {
      return;
    }
    await messageToUpdate.update({ ack });

    io.to(messageToUpdate.ticketId.toString()).emit("appMessage", {
      action: "update",
      message: messageToUpdate
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(`Error handling message ack. Err: ${err}`);
  }
};

const wbotMessageListener = (wbot: Session): void => {
  wbot.on("message_create", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("media_uploaded", async msg => {
    handleMessage(msg, wbot);
  });

  wbot.on("message_ack", async (msg, ack) => {
    handleMsgAck(msg, ack);
    if (WEBHOOK!=='' || WEBHOOK!==undefined){
            console.log("Webhook",WEBHOOK);
            axios.post(WEBHOOK, msg)
            .then((res) => {
             console.log(res.data);
            })
            .catch((error) => {
              console.error(error);
            })
        }  

    if(ack == 3) {
        // The message was read
        console.log('MESSAGE READ', msg);
    }
  });

wbot.on('change_battery', (batteryInfo) => {
    // Battery percentage for attached device has changed
    BATTERY = batteryInfo.battery;
	PLUGGED = batteryInfo.plugged;
    console.log(`Battery: ${BATTERY}% - Charging? ${PLUGGED}`);
});

function get_json(str) {
        var result = [];
        str = str.substr(str.lastIndexOf('T') + 1);
        result['hour'] = Number(str.substring(0, str.indexOf(':')));
        str = str.substring(str.indexOf(':') + 1);
        result['minute'] = Number(str.substring(0, str.indexOf(':')));
        str = str.substring(str.indexOf(':') + 1);
        result['second'] = Number(str.substring(0, str.indexOf('.')));
        return result;
}

/*SET WEBHOOK*/
wbot.on('message', async msg => {
    console.log('MESSAGE RECEIVED', msg);
    if(msg.hasMedia) {
        var rndid = makeid(32);
        const media = await msg.downloadMedia();
        // do something with the media data here
                //msg.caption = msg.body;
                var jsonString = JSON.stringify({ key: msg.mediaKey, url: URLAPI+"/public/"+rndid+"."+mime.extension(media.mimetype) });
                msg.mediaKey = jsonString;
		//msg.url = "";

                var imageBuffer = Buffer.from(media.data, 'base64');
                fs.writeFile('./public/'+rndid+'.'+mime.extension(media.mimetype), imageBuffer, function(err) {
                    if (err) {
                      return console.log(err);
                    }
                    console.log('The file was saved!');
                });
        //console.log("ada file " + rndid);
    }
	//if(msg.type=='chat'){
		
		if (WEBHOOK!=='' || WEBHOOK!==undefined){
            const contact = await msg.getContact();
            const name = contact.name;
            const pushname = contact.pushname;
            const verifiedname = contact.verifiedName;
            const chat = await msg.getChat();
            
			console.log("Webhook",WEBHOOK);
			axios.post(WEBHOOK, msg)
			.then((res) => {
			  console.log(`statusCode: ${res.statusCode}`);
			  console.log(res.data);
			})
			.catch((error) => {
			  console.error(error);
			})
		}  
	//}
});
/*SET WEBHOOK*/

/* API WEBHOOK */
function makeid(length) {
   var result           = '';
   var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   var charactersLength = characters.length;
   for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}

app.post('/send', async (req, res)=>{ 
/* Usage: post request to /send with json body {"num" : "551912345678", "message": "Hello"} */
/* To send to multiple numbers use: {"num" : "551912345678, 551912345678", "message": "Hello"} */
/* 55 is the brazilian country phone area code, change to yours country code and yours phone number also */
  let num = req.body.num;
  let msg = req.body.message;
  let token = req.body.token;

  let numbers = Array();
/*cek token*/
  if(token!=TOKEN) {
      res.json({status: "error", detail: "Wrong token!"});
  } else {
	  num.split(',').map((number)=>{ 
	    numbers.push(number.trim()) 
	  });  


	  try{

	      const success = Array();
	      for(let i=0; i<numbers.length; i++){

		let number = numbers[i]+'@c.us'; 
		const data = await wbot.sendMessage(number, msg);

		if(data.ack === 0){
		  success.push({success: true, number: numbers[i], detail: numbers[i] + ", Message status success"});
		}else{
		  success.push({success: false, number: numbers[i], detail: numbers[i] + ", Message status failed"});
		}

	      } 

	      res.json({status: success})


	  }catch(err){

	    res.json({status: "error", detail: "Failed to send message, Please authenticate or scan generated barcode"});

	  }
   }	
})

app.post('/sendMedia', async (req, res)=>{ 
/* Usage: post request to /sendMedia with json body {"num": "551912345678", "message": "Hello", "file": "http://localhost/pdf/test.pdf"} */
/* File-type can be: pdf, jpg, png, and others */
  let fileUrl = req.body.file;
  let caption = req.body.message;
  let num = req.body.num; 
  let token = req.body.token; 

  let numbers = Array();
/*cek token*/
if(token!=TOKEN) {
      res.json({status: "error", detail: "Wrong token!"});
  } else {
	  num.split(',').map((number)=>{ 
	    numbers.push(number.trim()) 
	  }); 



	  try{

	    let request = await axios.get(fileUrl, {responseType: 'stream'});

	    let cType = request.headers['content-type'];
	    const fileExt = mime.extension(cType);

	    let code = makeid(10).toUpperCase();
	    const dirLoc = './public/'+code
	    fs.mkdirSync(dirLoc);
	    const fname = makeid(10).toUpperCase()+"."+fileExt;


	    const dataUpload = request.data.pipe(fs.createWriteStream(dirLoc+'/'+fname));
	    dataUpload.on('finish', async ()=>{

	      const media = MessageMedia.fromFilePath(dirLoc+"/"+fname); 
	      const success = Array();

	      for(let i=0; i<numbers.length; i++){
		const data = await wbot.sendMessage(numbers[i]+'@c.us', media, {caption: caption}); 
		if(data.ack === 0){
		  success.push({success: true, number: numbers[i], detail: numbers[i] + ", Message status success"});
		}else{
		  success.push({success: false, number: numbers[i], detail: numbers[i] + ", Message status failed"});
		}
	      }


	      fs.unlinkSync(dirLoc+"/"+fname);
	      fs.rmdirSync(dirLoc);

	      res.json({status: success});
	      res.end();

	    })

	  }catch(err){

	    res.json({status: "error", details: "failed to check the URL!"});

	  }
   }


});

app.get('/device', (req, res) => {
  let token = req.body.token; 
/*cek token*/
  if(token!=TOKEN) {
      res.json({status: "error", detail: "Wrong token!"});
  } else {
        wbot.getState().then(function(result){
    		let info = wbot.info;
            log = {
                "success": true,
                "status": result,
                "alias": info.pushname,
                "mynumber": info.me.user,
                "brand": info.phone.device_manufacturer,
                "model": info.phone.device_model,
                "platform": info.platform,
                "battery": BATTERY,
                "plugged": PLUGGED
    		};
            res.json(log);
    		console.log(log);
        }).catch(err => {
            log = {
                "success": true,
                "status":"disconnected"
            };
            res.json(log);
            console.log(err);
        });
    }
});


app.listen('3030');
/* API WEBHOOK */

};

export { wbotMessageListener, handleMessage };
