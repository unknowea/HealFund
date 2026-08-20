import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import mongoose from 'mongoose';
import { fileURLToPath } from 'url';
import Appointment from '../models/Appointment.js';
import Queue from '../models/Queue.js';
import PatientDocument from '../models/PatientDocument.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// File upload configuration
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  },
});

const allowedExtensions = [
  '.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt',
  '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tiff', '.heic',
  '.dcm', '.dicom',
  '.xls', '.xlsx', '.csv',
  '.zip', '.rar', '.7z',
];

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExtensions.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error(`File format "${ext}" is not supported. Allowed formats: PDF, DOCX, JPG, PNG, WEBP, DICOM, XLSX, ZIP, etc.`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB per file limit
});

// Helper to format appointment object for frontend consumption
const serializeAppt = (appt) => {
  const doc = appt.toObject ? appt.toObject() : appt;
  return {
    ...doc,
    id: doc.appointmentId || (doc._id ? doc._id.toString() : null),
  };
};

// Helper to find appointment by appointmentId OR ObjectId
const findApptById = async (id) => {
  if (!id) return null;
  let appt = await Appointment.findOne({ appointmentId: id });
  if (!appt && mongoose.Types.ObjectId.isValid(id)) {
    appt = await Appointment.findById(id);
  }
  return appt;
};

// GET /api/appointments — fetch appointments with optional filtering & search
router.get('/', async (req, res) => {
  try {
    const { patientId, status, search } = req.query;
    let filter = {};

    if (patientId) {
      filter.$or = [{ patientId }, { bookedByUserId: patientId }];
    }

    if (status && status !== 'All') {
      if (status === 'Pending Review') {
        filter.status = { $in: ['Pending Review', 'Additional Documents Required'] };
      } else {
        filter.status = status;
      }
    }

    let list = await Appointment.find(filter).sort({ createdAt: -1 }).lean();

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (a) =>
          (a.patientName && a.patientName.toLowerCase().includes(q)) ||
          (a.patientId && a.patientId.toLowerCase().includes(q)) ||
          (a.disease && a.disease.toLowerCase().includes(q)) ||
          (a.appointmentId && a.appointmentId.toLowerCase().includes(q))
      );
    }

    const appointments = list.map(serializeAppt);
    res.json({ success: true, appointments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/appointments/:id — fetch single appointment
router.get('/:id', async (req, res) => {
  try {
    const appointment = await findApptById(req.params.id);
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
    res.json({ success: true, appointment: serializeAppt(appointment) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/appointments — create new appointment (supports multiple supporting files & diverse formats)
router.post('/', (req, res, next) => {
  // Run multer and handle file-filter errors gracefully without aborting the whole request
  upload.any()(req, res, (err) => {
    if (err) {
      // Non-fatal: log the multer error but still allow the request to continue without the rejected file
      console.warn('[multer] file rejected or upload error:', err.message);
    }
    next();
  });
}, async (req, res) => {
  try {
    // Explicitly strip any stringified supportingFiles from req.body — files always come from req.files (multer)
    delete req.body.supportingFiles;

    const {
      patientId,
      bookedByUserId,
      isForSelf,
      patientName,
      patientAge,
      patientGender,
      relationship,
      urgency,
      disease,
      preferredDepartment,
      patientPhone,
    } = req.body;

    const isSelf = isForSelf === true || isForSelf === 'true';
    const effectivePatientId = patientId || `HF-${String(Math.floor(1000 + Math.random() * 9000))}`;
    const effectivePatientName = patientName || (isSelf ? 'Patient' : 'Dependent Patient');

    const supportingFiles = [];
    const filesList = req.files || (req.file ? [req.file] : []);

    for (const f of filesList) {
      const ext = f.originalname.split('.').pop().toLowerCase();
      const docId = `DOC-${String(Date.now()).slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const fileObj = {
        id: docId,
        originalName: f.originalname,
        filename: f.filename,
        size: (f.size / (1024 * 1024)).toFixed(2) + ' MB',
        type: ext,
        uploadDate: new Date(),
      };
      supportingFiles.push(fileObj);

      await PatientDocument.create({
        documentId: docId,
        patientId: effectivePatientId,
        patientName: effectivePatientName,
        originalName: f.originalname,
        filename: f.filename,
        size: fileObj.size,
        type: ext,
        category: 'Appointment Supporting Document',
        status: 'Pending Verification',
      });
    }

    const appointment = await Appointment.create({
      patientId: effectivePatientId,
      bookedByUserId: bookedByUserId || effectivePatientId,
      isForSelf: isSelf,
      patientName: effectivePatientName,
      patientAge: patientAge ? parseInt(patientAge) : undefined,
      patientGender: patientGender || 'Unspecified',
      relationship: isSelf ? 'Self' : relationship || 'Other',
      urgency: urgency || 'Medium',
      disease: disease || 'General health consultation',
      preferredDepartment: preferredDepartment || 'General Medicine',
      patientPhone: patientPhone || '',
      hospitalName: 'Zewditu Memorial Hospital',
      status: 'Pending Review',
      supportingFiles,
      requestedAt: new Date(),
    });

    res.status(201).json({
      success: true,
      message: 'Appointment request submitted successfully. Waiting for admin review.',
      appointment: serializeAppt(appointment),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/appointments/:id/approve — admin approves appointment & allocates queue token
router.put('/:id/approve', async (req, res) => {
  try {
    const { department, roomNumber, assignedDoctor, urgency } = req.body;
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    const targetDept = department || appt.preferredDepartment || 'General Medicine Clinic';
    const targetRoom = roomNumber || 'Room 101';
    const targetDoctor = assignedDoctor || 'Dr. M. Worku';
    const targetUrgency = urgency || appt.urgency || 'Medium';

    let queueToken = appt.queueToken;
    if (!queueToken) {
      const queueCount = await Queue.countDocuments();
      queueToken = `C-${String(queueCount + 25).padStart(3, '0')}`;
    }

    let queueEntry = await Queue.findOne({
      $or: [{ token: queueToken }, { appointmentId: appt.appointmentId }],
    });

    const deptStr = targetDept.includes('Clinic') ? targetDept : `${targetDept} Clinic`;

    if (!queueEntry) {
      queueEntry = await Queue.create({
        token: queueToken,
        appointmentId: appt.appointmentId,
        patientId: appt.patientId,
        patientName: appt.patientName,
        department: deptStr,
        roomNumber: targetRoom,
        assignedDoctor: targetDoctor,
        urgency: targetUrgency,
        durationMinutes: 10,
        status: 'Scheduled',
        estimatedTime: new Date(Date.now() + 86400000),
        requiredDocuments: (appt.supportingFiles || []).map((f) => f.originalName).concat(['Patient ID / QR Card']),
      });
    } else {
      queueEntry.token = queueToken;
      queueEntry.department = deptStr;
      queueEntry.roomNumber = targetRoom;
      queueEntry.assignedDoctor = targetDoctor;
      queueEntry.urgency = targetUrgency;
      queueEntry.status = 'Scheduled';
      await queueEntry.save();
    }

    appt.status = 'Approved';
    appt.assignedDepartment = deptStr;
    appt.assignedRoom = targetRoom;
    appt.assignedDoctor = targetDoctor;
    appt.urgency = targetUrgency;
    appt.queueToken = queueToken;
    appt.reviewedAt = new Date();
    appt.adminNote = `Approved for ${deptStr}, ${targetRoom}.`;

    await appt.save();

    res.json({
      success: true,
      appointment: serializeAppt(appt),
      queueToken,
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/appointments/:id/reject — admin rejects appointment with reason
router.put('/:id/reject', async (req, res) => {
  try {
    const { rejectionReason, adminNote } = req.body;
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    appt.status = 'Rejected';
    appt.rejectionReason = rejectionReason || 'Appointment criteria not met or hospital capacity exceeded.';
    appt.adminNote = adminNote || appt.rejectionReason;
    appt.reviewedAt = new Date();

    if (appt.queueToken) {
      await Queue.findOneAndUpdate({ token: appt.queueToken }, { status: 'Cancelled' });
    }

    await appt.save();

    res.json({
      success: true,
      appointment: serializeAppt(appt),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/appointments/:id/request-docs — admin requests additional documents
router.put('/:id/request-docs', async (req, res) => {
  try {
    const { requestedDocuments, adminNote } = req.body;
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    const docList = Array.isArray(requestedDocuments)
      ? requestedDocuments
      : typeof requestedDocuments === 'string'
      ? requestedDocuments.split(',').map((s) => s.trim()).filter(Boolean)
      : ['Additional Supporting Medical Documents'];

    appt.status = 'Additional Documents Required';
    appt.requestedDocuments = docList;
    appt.adminNote = adminNote || 'Please upload the requested supporting documents to proceed with approval.';
    appt.reviewedAt = new Date();

    await appt.save();

    res.json({
      success: true,
      appointment: serializeAppt(appt),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/appointments/:id/upload-additional-docs — patient uploads requested additional document(s)
router.post('/:id/upload-additional-docs', (req, res, next) => {
  upload.any()(req, res, (err) => {
    if (err) console.warn('[multer] upload-additional-docs error:', err.message);
    next();
  });
}, async (req, res) => {
  try {
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    const filesList = req.files || (req.file ? [req.file] : []);
    if (filesList.length === 0) return res.status(400).json({ success: false, message: 'No files uploaded' });

    if (!appt.supportingFiles) appt.supportingFiles = [];

    for (const f of filesList) {
      const ext = f.originalname.split('.').pop().toLowerCase();
      const docId = `DOC-${String(Date.now()).slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
      const fileObj = {
        id: docId,
        originalName: f.originalname,
        filename: f.filename,
        size: (f.size / (1024 * 1024)).toFixed(2) + ' MB',
        type: ext,
        uploadDate: new Date(),
      };
      appt.supportingFiles.push(fileObj);

      await PatientDocument.create({
        documentId: docId,
        patientId: appt.patientId,
        patientName: appt.patientName,
        originalName: f.originalname,
        filename: f.filename,
        size: fileObj.size,
        type: ext,
        category: 'Requested Additional Medical Document',
        status: 'Pending Verification',
      });
    }

    appt.status = 'Pending Review';
    await appt.save();

    res.json({
      success: true,
      message: 'Additional document(s) uploaded successfully! Admin will review your updated request.',
      appointment: serializeAppt(appt),
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/appointments/:id — general update
router.put('/:id', async (req, res) => {
  try {
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    // Protect supportingFiles from being overwritten by a stringified body value
    const { supportingFiles: _ignored, ...safeBody } = req.body;
    Object.assign(appt, safeBody);
    await appt.save();

    res.json({ success: true, appointment: serializeAppt(appt) });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/appointments/:id — delete appointment
router.delete('/:id', async (req, res) => {
  try {
    const appt = await findApptById(req.params.id);
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });

    if (appt.queueToken) {
      await Queue.findOneAndDelete({ token: appt.queueToken });
    }
    await appt.deleteOne();

    res.json({ success: true, message: 'Appointment cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
