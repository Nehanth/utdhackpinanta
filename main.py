from flask import Flask, request, jsonify
import cv2
import numpy as np
import base64
from io import BytesIO
from PIL import Image
from flask_cors import CORS
from datetime import datetime
import os

app = Flask(__name__)
CORS(app)

# Hardcoded API key
# DW I DEACTIVATED THE KEY :)
OPENAI_API_KEY = "KEY PLS"

from openai import OpenAI
client = OpenAI(api_key=OPENAI_API_KEY)

@app.route('/analyze-note', methods=['POST'])
def analyze_note():
    if not request.is_json:
        return jsonify({'error': 'Invalid content type, expecting application/json'}), 400

    data = request.get_json()
    if 'note' not in data:
        return jsonify({'error': "No doctor's note provided"}), 400

    note = data['note']
    try:
        # Use the OpenAI client to analyze the note
        completion = client.chat.completions.create(
            model="gpt-4",  # Corrected model name
            messages=[
                {"role": "user", "content": f"Analyze the following doctor's note and provide possible diagnoses:\n{note}"}
            ]
        )
        # Correctly access the content of the message
        diagnosis = completion.choices[0].message.content.strip()
        return jsonify({'success': True, 'analysis': diagnosis})

    except Exception as e:
        print(f"Error analyzing doctor's note: {str(e)}")
        return jsonify({'success': False, 'error': str(e)}), 500

# Create directories for saving images if they don't exist
SAVE_DIR = 'captured_images'
SUBDIRS = ['original', 'annotated', 'mask', 'result']
for subdir in SUBDIRS:
    os.makedirs(os.path.join(SAVE_DIR, subdir), exist_ok=True)

def save_images(original, annotated, mask, result):
    # Generate timestamp for unique filenames
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    # Save original image
    original_path = os.path.join(SAVE_DIR, 'original', f'image_{timestamp}.jpg')
    cv2.imwrite(original_path, original)
    
    # Save annotated image
    annotated_path = os.path.join(SAVE_DIR, 'annotated', f'image_{timestamp}.jpg')
    cv2.imwrite(annotated_path, annotated)
    
    # Save mask
    mask_path = os.path.join(SAVE_DIR, 'mask', f'image_{timestamp}.jpg')
    cv2.imwrite(mask_path, mask)
    
    # Save result
    result_path = os.path.join(SAVE_DIR, 'result', f'image_{timestamp}.jpg')
    cv2.imwrite(result_path, result)
    
    print(f"Images saved with timestamp: {timestamp}")
    print(f"Original: {original_path}")
    print(f"Annotated: {annotated_path}")
    print(f"Mask: {mask_path}")
    print(f"Result: {result_path}")
    
    return timestamp

def analyze_wound_image(image_data):
    try:
        # Convert base64 to image
        if ',' in image_data:
            image_data = image_data.split(',')[1]  # Remove data URL prefix if present
        image = Image.open(BytesIO(base64.b64decode(image_data)))
        frame = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)
        original = frame.copy()
        
        # Convert BGR to HSV color scheme
        hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
        
        # Define range of wound red color in HSV
        lower_red1 = np.array([0, 120, 70])
        upper_red1 = np.array([10, 255, 255])
        lower_red2 = np.array([170, 120, 70])
        upper_red2 = np.array([180, 255, 255])
        
        # Threshold the HSV image to get only red colors that match with wound colors
        mask1 = cv2.inRange(hsv, lower_red1, upper_red1)
        mask2 = cv2.inRange(hsv, lower_red2, upper_red2)
        mask = cv2.bitwise_or(mask1, mask2)
        
        # Bitwise-AND mask and original image
        res = cv2.bitwise_and(frame, frame, mask=mask)
        
        # Add analysis text
        font = cv2.FONT_HERSHEY_SIMPLEX
        cv2.putText(frame, 'Analyzing wound area...', (10, 50), font, 1, (99, 74, 154), 3, cv2.LINE_AA)
        
        # Find contours
        contours, hierarchy = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        
        if not contours:
            raise ValueError("No wound area detected in the image.")
        
        # Find the largest contour
        cnt = max(contours, key=cv2.contourArea)
        
        # Compute bounding rectangle for the largest contour
        x, y, w, h = cv2.boundingRect(cnt)
        left, top, right, bottom = x, y, x + w, y + h
        
        # Draw rectangle
        cv2.rectangle(frame, (left, top), (right, bottom), (255, 0, 0), 2)
        
        # Calculate area
        areacnt = cv2.contourArea(cnt)
        # Assuming 208154 is a reference area in pixels; adjust as necessary
        arearatio = ((areacnt) / 208154) * 100
        
        # Calculate measurements
        # Assuming conversion factors; adjust based on actual scale
        wound_area_cm2 = round(arearatio * 0.6615, 2)
        custom_aid_area_cm2 = round((w * h) * 2.989 * 1e-4, 2)
        length_cm = round(w / 95.23, 2)
        width_cm = round(h / 95.23, 2)
        
        # Save all images
        timestamp = save_images(original, frame, mask, res)
        
        # Convert results back to base64
        _, buffer_frame = cv2.imencode('.jpg', frame)
        _, buffer_mask = cv2.imencode('.jpg', mask)
        _, buffer_res = cv2.imencode('.jpg', res)
        
        frame_b64 = base64.b64encode(buffer_frame).decode('utf-8')
        mask_b64 = base64.b64encode(buffer_mask).decode('utf-8')
        res_b64 = base64.b64encode(buffer_res).decode('utf-8')
        
        return {
            'success': True,
            'timestamp': timestamp,
            'measurements': {
                'wound_area': wound_area_cm2,
                'custom_aid_area': custom_aid_area_cm2,
                'length': length_cm,
                'width': width_cm
            },
            'images': {
                'annotated': f'data:image/jpeg;base64,{frame_b64}',
                'mask': f'data:image/jpeg;base64,{mask_b64}',
                'result': f'data:image/jpeg;base64,{res_b64}'
            }
        }
        
    except Exception as e:
        print(f"Error processing image: {str(e)}")
        return {
            'success': False,
            'error': str(e)
        }

@app.route('/analyze-wound', methods=['POST', 'OPTIONS'])
def analyze_wound():
    if request.method == 'OPTIONS':
        return '', 200
        
    if not request.is_json:
        return jsonify({'error': 'Invalid content type, expecting application/json'}), 400
    
    data = request.get_json()
    if 'image' not in data:
        return jsonify({'error': 'No image data provided'}), 400
    
    image_data = data['image']
    result = analyze_wound_image(image_data)
    
    if result['success']:
        return jsonify(result)
    else:
        return jsonify({'error': result['error']}), 500

if __name__ == '__main__':
    print("Starting Flask server...")
    print(f"Images will be saved in: {os.path.abspath(SAVE_DIR)}")
    app.run(host='0.0.0.0', port=5000)
